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
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { closeDb, getConnection, openDb } from "./main/db";
import { runMigrations } from "./main/db/migrate";
import { databasePath } from "./main/db/paths";
import { registerAllIpc } from "./main/ipc";
import { registerAppScheme, registerAppSchemePrivileges } from "./main/scheme";
import * as lock from "./main/services/lock";
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

	app.whenReady().then(() => {
		openDb(databasePath());

		const migrations = runMigrations(getConnection());
		if (migrations.applied.length > 0) {
			console.log(`Applied ${migrations.applied.length} migration(s):`, migrations.applied);
		}

		lock.start({
			method: "none",
			idleMinutes: 15,
			lockOnSleep: true,
			lockOnMinimise: false,
		});

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
					console.log(`SMOKE_READY migrations=${migrations.applied.length} db=${databasePath()}`);
					app.quit();
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
