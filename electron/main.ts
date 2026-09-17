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
import { databasePath } from "./main/db/paths";
import { registerAllIpc } from "./main/ipc";
import { registerAppScheme, registerAppSchemePrivileges } from "./main/scheme";
import { setCloseHook } from "./main/services/backup";
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
						// A screenshot is the only part of this that can catch a window that
						// loads without error and still renders nothing.
						const shotDir = process.env.BUREAU_SMOKE_SHOT;
						if (shotDir) {
							const { writeFileSync, mkdirSync } = await import("node:fs");
							const { join: joinPath } = await import("node:path");
							mkdirSync(shotDir, { recursive: true });
							for (const theme of ["light", "dark"] as const) {
								nativeTheme.themeSource = theme;
								await window.webContents.executeJavaScript(
									`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
								);
								await new Promise((r) => setTimeout(r, 400));
								const image = await window.webContents.capturePage();
								writeFileSync(joinPath(shotDir, `bureau-${theme}.png`), image.toPNG());
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
