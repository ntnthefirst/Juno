import { BrowserWindow } from "electron";
import { join } from "node:path";
import { hardenWindow, titleBarOptions, viewUrl } from "./chrome";

/**
 * The one application window. There is never a second: see windows/index.ts,
 * which owns that rule. Settings opens as a fixed modal child instead, so the
 * two cannot drift apart or edit the same record at once.
 */
export function createMainWindow(isDev: boolean): BrowserWindow {
	const window = new BrowserWindow({
		width: 1320,
		height: 860,
		minWidth: 560,
		minHeight: 520,
		show: false,
		backgroundColor: "#f6f6fa",
		...titleBarOptions(),
		webPreferences: {
			// dist-electron/main/windows -> dist-electron/preload.js
			preload: join(__dirname, "..", "..", "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webviewTag: false,
			// Off in development too. A renderer that can reach the filesystem
			// through a dev-only escape hatch is a renderer nobody tested locked
			// down until the day it shipped.
			webSecurity: true,
		},
	});

	hardenWindow(window, isDev);

	window.once("ready-to-show", () => window.show());

	void window.loadURL(viewUrl(isDev, "main"));

	return window;
}
