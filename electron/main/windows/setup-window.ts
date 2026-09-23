import { BrowserWindow } from "electron";
import { join } from "node:path";
import { hardenWindow, titleBarOptions, viewUrl, windowIcon } from "./chrome";

/**
 * The first run is a window, for the same reason settings is one (decision 26,
 * and now decision 34).
 *
 * It used to replace the whole shell, which made six short questions look like
 * an application in their own right and gave a 1600px monitor one field per
 * screenful. A modal child window is the honest shape: small, fixed, in front
 * of the app it is about to configure, and impossible to walk away from
 * half-answered, because the operating system refuses input to the window
 * behind it until this one closes.
 *
 * Smaller than settings on purpose. Nothing here is a table or a list; it is
 * one question at a time with at most three fields under it.
 */
const WIDTH = 760;
const HEIGHT = 620;

export function createSetupWindow(parent: BrowserWindow, isDev: boolean): BrowserWindow {
	const window = new BrowserWindow({
		parent,
		modal: true,
		width: WIDTH,
		height: HEIGHT,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		show: false,
		icon: windowIcon(),
		backgroundColor: "#f6f6fa",
		...titleBarOptions(),
		webPreferences: {
			// dist-electron/main/windows -> dist-electron/preload.js
			preload: join(__dirname, "..", "..", "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webviewTag: false,
			webSecurity: true,
		},
	});

	window.setMenuBarVisibility(false);

	hardenWindow(window, isDev);

	window.once("ready-to-show", () => window.show());

	void window.loadURL(viewUrl(isDev, "setup"));

	return window;
}
