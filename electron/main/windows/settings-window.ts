import { BrowserWindow } from "electron";
import { join } from "node:path";
import { hardenWindow, titleBarOptions, viewUrl, windowIcon } from "./chrome";

/**
 * Settings is a window, not a screen.
 *
 * It is a modal child of the main window, which is what makes the operating
 * system refuse clicks on the application behind it until it is closed. That is
 * deliberate: settings changes the shape of what the rest of the app is showing
 * (accounts, reference data, the lock), and letting someone edit a client on one
 * side while removing its status on the other is a race with no good outcome.
 *
 * Fixed size, deliberately. Every section is a single column of fields, so there
 * is nothing a wider window would show and nothing a taller one would fix.
 */
const WIDTH = 920;
const HEIGHT = 680;

export function createSettingsWindow(parent: BrowserWindow, isDev: boolean): BrowserWindow {
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

	// Nothing about settings needs a menu bar, and on Windows the default one
	// reappears on Alt over a frameless window.
	window.setMenuBarVisibility(false);

	hardenWindow(window, isDev);

	window.once("ready-to-show", () => window.show());

	void window.loadURL(viewUrl(isDev, "settings"));

	return window;
}
