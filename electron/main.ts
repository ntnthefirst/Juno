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
import { backupsDir, databasePath, documentsDir, mailDir, userDataDir } from "./main/db/paths";
import { safeStorageCredentialStore } from "./main/credential-store";
import { registerAllIpc } from "./main/ipc";
import { registerAppScheme, registerAppSchemePrivileges } from "./main/scheme";
import { configureBackups, setCloseHook } from "./main/services/backup";
import { configureDocuments } from "./main/services/document-pdf";
import { ensureTemplatesSeeded } from "./main/services/document-templates";
import * as notifications from "./main/services/notifications";
import { ensureRemindersSeeded } from "./main/services/reminders-derive";
import * as lock from "./main/services/lock";
import * as documentActions from "./main/services/document-actions";
import { configureCredentialStore } from "./main/services/mail-credentials";
import { openImapSource } from "./main/services/mail-imap";
import { configureMailboxSource } from "./main/services/mail-source";
import * as mailSend from "./main/services/mail-send";
import { imapSentAppender, smtpTransport } from "./main/services/mail-smtp";
import * as mailSync from "./main/services/mail-sync";
import { ensureMailTemplatesSeeded } from "./main/services/mail-templates";
import { configureMailTransport } from "./main/services/mail-transport";
import { configureMailThreads } from "./main/services/mail-threads";
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
		configureMailThreads(mailDir());
		// Sync never starts while locked and stops at the next step when the lock
		// comes on, per decision 15.
		mailSync.configureMailSync({ mailDir: mailDir(), isPaused: () => lock.isLocked() });
		configureMailboxSource(openImapSource);
		configureMailTransport(smtpTransport, imapSentAppender);
		// The sender pauses with the lock too, and renders a PDF for an attached
		// document through the same path the documents screen uses.
		mailSend.configureMailSend({
			isPaused: () => lock.isLocked(),
			renderDocumentPdf: async (id) => (await documentActions.renderPdf(id)).pdfPath,
		});
		// safeStorage is usable now that the app is ready, and not before.
		configureCredentialStore(safeStorageCredentialStore);

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

		const mailTemplateSeed = await ensureMailTemplatesSeeded(db);
		if (mailTemplateSeed.created || mailTemplateSeed.updated) {
			console.log(
				`Mail templates: ${mailTemplateSeed.created} created, ${mailTemplateSeed.updated} updated`,
			);
		}

		const reminderSeed = await ensureRemindersSeeded(db);
		if (reminderSeed.created) {
			console.log(`Reminders: ${reminderSeed.created} created`);
		}

		// Restoring a backup replaces the live file, which cannot happen while the
		// connection holds it open. The service asks for the close rather than
		// importing app lifecycle code itself.
		setCloseHook(() => closeDb());

		lock.start(await settings.getLock());

		registerAllIpc();

		// In development only the mail host is served; the window comes from Vite.
		registerAppScheme(isDev ? null : join(app.getAppPath(), "dist"));

		const window = createMainWindow(isDev);
		lock.watchWindow(window);

		// One summary a day, never one per reminder. See services/notifications.ts.
		if (!process.env.BUREAU_SMOKE) {
			notifications.start();
			mailSync.startScheduler();
			mailSend.startScheduler();
		}

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
							// No server in a smoke run: the sync reads from a mailbox in memory.
							const { openSmokeMailbox, smokeTransport, smokeAppender } = await import("./main/smoke-mailbox");
							configureMailboxSource(openSmokeMailbox);
							configureMailTransport(smokeTransport, smokeAppender);
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

								// Phase 2: a few reminders across the buckets, plus a delivered
								// project so a suggestion appears.
								const iso = (offset) => {
									const d = new Date();
									d.setDate(d.getDate() + offset);
									return d.toISOString().slice(0, 10);
								};
								await b.reminders.create({ title: "Chase the noir deposit", dueOn: iso(-4), category: "payment", clientId: made[2].id });
								await b.reminders.create({ title: "Send hyge the proposal", dueOn: iso(0), category: "other", clientId: made[3].id });
								await b.reminders.create({ title: "Renew the hosting for bodhi", dueOn: iso(5), category: "renewal", pattern: "years", interval: 1, leadDays: 30, clientId: made[1].id });
								await b.settings.setAccountingTool({ name: "the accounting tool", url: "https://example.invalid" });
								const ps2 = await b.reference.getSet("project_status");
								const delivered = ps2.items.find((i) => i.key === "delivered");
								const bodhiProjects = await b.projects.list({ clientId: made[1].id });
								if (delivered && bodhiProjects[0]) {
									await b.projects.update(bodhiProjects[0].id, { statusId: delivered.id });
								}

								// Phase 3: an account through the bridge, then a sync against the
								// in-memory mailbox the main process swapped in above. This is
								// what exercises the credential store, the scheme host and the
								// reader's frame policy.
								await b.settings.setOwner({ businessName: "Bureau", contactName: "Nathan", email: "hallo@bureau.test", city: "Gent" });
								const mailAccount = await b.mail.accounts.create({ email: "hallo@bureau.test", label: "Bureau", imapHost: "imap.bureau.test", smtpHost: "smtp.bureau.test", password: "smoke" });
								const synced = await b.mail.sync.run();
								if (synced.some((s) => s.phase !== "done")) throw new Error("Smoke: mail sync did not finish: " + JSON.stringify(synced));

								// Phase 4: a cover mail from a template with the document attached,
								// sent by a person, and a second one an agent would have to wait on.
								const coverTemplate = (await b.mail.templates.list()).find((t) => t.key === "contract_cover");
								const rendered = await b.mail.templates.render({ templateId: coverTemplate.id, clientId: made[0].id, extras: { title: "de ontwikkelovereenkomst" } });
								const draft = await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: "Laura", address: "laura@obet.be" }], subject: rendered.subject,
									bodyText: rendered.bodyText, bodyHtml: rendered.bodyHtml, clientId: made[0].id, templateId: coverTemplate.id,
									documentIds: [gen.document.id],
								});
								await b.mail.outbox.send(draft.id);
								await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: null, address: "info@noir.be" }], subject: "Even navragen",
									bodyText: "Dag,\\n\\nIs de offerte goed ontvangen?\\n\\nGroeten", clientId: made[2].id,
								});

								return (await b.clients.list()).length;
							})()`);
							console.log(`SMOKE_DEMO clients=${created}`);
							// The sender is not scheduled in a smoke run, so it is asked directly,
							// and the row has to come out the other side as sent.
							const sentCount = await mailSend.processQueue();
							const outboxRows = await (await import("./main/services/mail-outbox")).list({ states: ["sent"] });
							if (sentCount !== 1 || outboxRows.length !== 1 || outboxRows[0]!.attachments.length !== 1) {
								throw new Error(`Smoke: the outbox did not send the cover mail: ${JSON.stringify(outboxRows)}`);
							}
							console.log(`SMOKE_DEMO outbox sent=${outboxRows[0]!.messageId}`);
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
							const screens = process.env.BUREAU_SMOKE_DEMO ? ["Today", "Reminders", "Clients", "Mail", "Outbox", "Documents", "Templates", "Settings"] : ["Clients"];
							for (const screen of screens) {
								// Outbox is a view inside Mail rather than a sidebar entry.
								const sidebarEntry = screen === "Outbox" ? "Mail" : screen;
								const clicked = await window.webContents.executeJavaScript(
									`(() => { const b = [...document.querySelectorAll("nav button")]
										.find((el) => el.textContent.trim() === ${JSON.stringify(sidebarEntry)});
										if (b) b.click(); return Boolean(b); })()`,
								);
								if (!clicked) throw new Error(`Smoke: no sidebar entry for ${screen}`);
								await new Promise((r) => setTimeout(r, 800));
								if (screen === "Outbox") {
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Outbox"));
											if (!nav) return "no outbox entry";
											nav.click();
											await new Promise((r) => setTimeout(r, 600));
											const row = document.querySelector("ul li button");
											if (!row) return "no rows";
											row.click();
											await new Promise((r) => setTimeout(r, 600));
											return "ok";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: outbox ${opened}`);
								}
								if (screen === "Mail") {
									// Opens the newest thread, so the reader and its frame are in
									// the picture, and checks the frame actually loaded a body.
									const mailResponses: { url: string; statusCode: number }[] = [];
									window.webContents.session.webRequest.onCompleted({ urls: ["app://mail/*"] }, (details) => {
										mailResponses.push({ url: details.url, statusCode: details.statusCode });
									});
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const row = document.querySelector("ul li button");
											if (!row) return "no rows";
											row.click();
											await new Promise((r) => setTimeout(r, 1200));
											return document.querySelector("iframe") ? "ok" : "no frame";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: mail reader ${opened}`);
									// A frame the CSP refused would sit on about:blank. One that
									// navigated to the mail origin proves the scheme host answered
									// and the frame-src rule let it through.
									const mailFrame = window.webContents.mainFrame.framesInSubtree.find((f) =>
										f.url.startsWith("app://mail/message/"),
									);
									if (!mailFrame) throw new Error("Smoke: the message frame did not load from app://mail");
									// The frame is sandboxed, so nothing can be asked of its document,
									// which is the point. The request log says whether the scheme
									// host answered it with a body.
									const served = mailResponses.find((r) => r.url === mailFrame.url);
									if (!served || served.statusCode !== 200) {
										throw new Error(`Smoke: the message frame got ${served?.statusCode ?? "no response"}`);
									}
									console.log(`SMOKE_DEMO mail frame=${mailFrame.url}`);
									await new Promise((r) => setTimeout(r, 400));
								}
								// Settings is taller than the window, so the lower sections are
								// photographed too rather than assumed to render.
								const offsets = screen === "Settings" ? [0, 1, 2, 3, 4, 5] : [0];
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
		notifications.stop();
		mailSync.stopScheduler();
		mailSend.stopScheduler();
		closeDb();
	});
}
