import { BrowserWindow } from "electron";
import { join } from "node:path";
import { prefillToQuery } from "../../shared/new-record";
import type { NewRecordKind, NewRecordPrefill } from "../../shared/types";
import { hardenWindow, titleBarOptions, viewUrl, windowIcon } from "./chrome";

/**
 * Making a new event, client, project or reminder happens in a small window
 * (decision 60), the shape the design draws for all four.
 *
 * A modal child of the main window, like settings and setup, so the person
 * finishes or cancels before the application behind it is usable again.
 * Fixed size: each one is a short column of fields over a footer, and a wider
 * window would only stretch the inputs.
 */
const WIDTH = 720;
const HEIGHT = 640;

export function createNewRecordWindow(
	parent: BrowserWindow,
	isDev: boolean,
	kind: NewRecordKind,
	prefill: NewRecordPrefill,
): BrowserWindow {
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

	void window.loadURL(viewUrl(isDev, "new", kind, prefillToQuery(prefill)));

	return window;
}
