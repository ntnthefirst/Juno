/**
 * Entry point. Order matters more than usual here, so it is spelled out.
 *
 * 1. Scheme privileges, before ready. Electron ignores them afterwards.
 * 2. Single instance. Two processes on one SQLite file is corruption waiting.
 * 3. Database open and migrate, before anything can read it.
 * 4. Lock started, before IPC, so the guard has real state to consult.
 * 5. IPC registered, guard first.
 * 6. Window last, so it never paints against a half-built backend.
 */
import { app, BrowserWindow, nativeTheme } from "electron";
import { join } from "node:path";
import { closeDb, getConnection, openDb } from "./main/db";
import { runMigrations } from "./main/db/migrate";
import { backupsDir, databasePath, documentsDir, userDataDir } from "./main/db/paths";
import { registerAllIpc } from "./main/ipc";
import { registerAppScheme, registerAppSchemePrivileges } from "./main/scheme";
import { configureBackups, setCloseHook } from "./main/services/backup";
import { configureDocuments } from "./main/services/document-pdf";
import { ensureTemplatesSeeded } from "./main/services/document-templates";
import * as lock from "./main/services/lock";
import { ensureSeeded } from "./main/services/seed";
import * as settings from "./main/services/settings";
import { createMainWindow } from "./main/windows/main-window";

const isDev = Boolean(process.env.BUREAU_DEV);

registerAppSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		const [existing] = BrowserWindow.getAllWindows();
		if (existing) {
			if (existing.isMinimized()) existing.restore();
			existing.focus();
		}
	});

	app.whenReady().then(async () => {
		// Paths are injected here rather than read inside each service, so no
		// service has to import `electron` and every one stays testable in plain
		// Node.
		settings.configureSettings(userDataDir());
		configureBackups({ directory: backupsDir(), databaseFile: databasePath() });
		configureDocuments(documentsDir());

		const db = openDb(databasePath());

		const migrations = runMigrations(getConnection());
		if (migrations.applied.length > 0) {
			console.log(`Applied ${migrations.applied.length} migration(s):`, migrations.applied);
		}

		// Reference data is seeded before the window exists, so the first screen is
		// never a set of empty dropdowns. Idempotent, so this is cheap on every
		// launch after the first.
		const seeded = await ensureSeeded(db);
		if (seeded.setsCreated || seeded.itemsCreated || seeded.itemsUpdated) {
			console.log(
				`Seed v${seeded.fromVersion} -> v${seeded.toVersion}: ` +
					`${seeded.setsCreated} set(s), ${seeded.itemsCreated} new item(s), ` +
					`${seeded.itemsUpdated} updated`,
			);
		}

		const templateSeed = await ensureTemplatesSeeded(db);
		if (templateSeed.created || templateSeed.updated) {
			console.log(
				`Templates: ${templateSeed.created} created, ${templateSeed.updated} updated`,
			);
		}

		// Restoring a backup replaces the live file, which cannot happen while the
		// connection holds it open. The service asks for the close rather than
		// importing app lifecycle code itself.
		setCloseHook(() => closeDb());

		lock.start(await settings.getLock());

		registerAllIpc();

		if (!isDev) registerAppScheme(join(app.getAppPath(), "dist"));

		const window = createMainWindow(isDev);
		lock.watchWindow(window);

		// Lets `npm run smoke` prove the real application boots, paints and reaches
		// its database, rather than proving only that it compiles.
		if (process.env.BUREAU_SMOKE) {
			// Electron 41 passes a single event object here. The old positional
			// signature still fires but logs a deprecation warning on every message.
			window.webContents.on("console-message", (event) => {
				if (event.level === "warning" || event.level === "error") {
					console.error(`renderer: ${event.message}`);
				}
			});
			window.webContents.once("did-finish-load", () => {
				setTimeout(() => {
					void (async () => {
						// Drives the real preload bridge, so this exercises IPC, the services
						// and the database exactly as a person clicking would. Verifying the
						// interface against a mock would prove nothing about any of them.
						if (process.env.BUREAU_SMOKE_DEMO) {
							const created = await window.webContents.executeJavaScript(`(async () => {
								const b = window.bureau;
								const statuses = await b.reference.getSet("client_status");
								const active = statuses.items.find((i) => i.key === "active") ?? statuses.items[0];
								const lead = statuses.items.find((i) => i.key === "lead") ?? statuses.items[0];
								const made = [];
								for (const c of [
									{ name: "obet", city: "Gent", email: "hallo@obet.be", statusId: active.id },
									{ name: "bodhi", city: "Brugge", email: "info@bodhi.be", statusId: active.id },
									{ name: "noir", city: "Antwerpen", statusId: active.id },
									{ name: "hyge", city: "Leuven", statusId: lead.id },
								]) made.push(await b.clients.create(c));
								await b.contacts.create({ clientId: made[0].id, name: "Laura", role: "Zaakvoerder", email: "laura@obet.be", isPrimary: true });
								const ps = await b.reference.getSet("project_status");
								const running = ps.items.find((i) => i.key === "active") ?? ps.items[0];
								await b.projects.create({ clientId: made[0].id, name: "Ontwikkelovereenkomst site", statusId: running.id, dueOn: "2026-11-14", agreedValueCents: 210000 });
								await b.projects.create({ clientId: made[1].id, name: "Project scope", statusId: running.id, dueOn: "2026-10-03", agreedValueCents: 125000 });
								// Phase 1: generate a document through the same bridge the
								// interface uses, so the smoke run covers it too.
								const tpl = (await b.templates.list()).find((t) => t.key === "development_agreement");
								const gen = await b.documents.generate({
									clientId: made[0].id, templateId: tpl.id, projectId: (await b.projects.list({ clientId: made[0].id }))[0]?.id ?? null,
								});
								await b.documents.renderPdf(gen.document.id);
								return (await b.clients.list()).length;
							})()`);
							console.log(`SMOKE_DEMO clients=${created}`);
							window.webContents.reload();
							await new Promise((r) => {
								window.webContents.once("did-finish-load", () => setTimeout(r, 900));
							});
							// Selects a row, so the screenshot covers the detail pane as well as
							// the list. Clicking the real button also proves the row is reachable.
							await window.webContents.executeJavaScript(
								`(() => { const b = [...document.querySelectorAll("tbody button")]
									.find((el) => el.textContent.trim() === "obet");
									if (b) b.click(); return Boolean(b); })()`,
							);
							await new Promise((r) => setTimeout(r, 900));

						}

						// A screenshot is the only part of this that can catch a window that
						// loads without error and still renders nothing.
						const shotDir = process.env.BUREAU_SMOKE_SHOT;
						if (shotDir) {
							const { writeFileSync, mkdirSync } = await import("node:fs");
							const { join: joinPath } = await import("node:path");
							mkdirSync(shotDir, { recursive: true });
							const screens = process.env.BUREAU_SMOKE_DEMO ? ["Clients", "Documents", "Templates", "Settings"] : ["Clients"];
							for (const screen of screens) {
								const clicked = await window.webContents.executeJavaScript(
									`(() => { const b = [...document.querySelectorAll("nav button")]
										.find((el) => el.textContent.trim() === ${JSON.stringify(screen)});
										if (b) b.click(); return Boolean(b); })()`,
								);
								if (!clicked) throw new Error(`Smoke: no sidebar entry for ${screen}`);
								await new Promise((r) => setTimeout(r, 800));
								// Settings is taller than the window, so the lower sections are
								// photographed too rather than assumed to render.
								const offsets = screen === "Settings" ? [0, 1, 2] : [0];
								for (const theme of ["light", "dark"] as const) {
									nativeTheme.themeSource = theme;
									await window.webContents.executeJavaScript(
										`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
									);
									for (const page of offsets) {
										await window.webContents.executeJavaScript(
											`document.querySelector("main").scrollTop = ${page} * (window.innerHeight - 120)`,
										);
										await new Promise((r) => setTimeout(r, 400));
										const image = await window.webContents.capturePage();
										const suffix = offsets.length > 1 ? `-${page + 1}` : "";
										writeFileSync(
											joinPath(shotDir, `${screen.toLowerCase()}-${theme}${suffix}.png`),
											image.toPNG(),
										);
									}
								}
							}
						}
						console.log(`SMOKE_READY migrations=${migrations.applied.length} db=${databasePath()}`);
						app.quit();
					})();
				}, 1200);
			});
		}

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				lock.watchWindow(createMainWindow(isDev));
			}
		});
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	app.on("before-quit", () => {
		closeDb();
	});
}
