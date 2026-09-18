import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { MAIL_FRAME_ORIGIN } from "../../shared/types";
import { APP_ORIGIN } from "../scheme";

const DEV_URL = "http://localhost:5173";

/**
 * The CSP the renderer runs under.
 *
 * `connect-src` allows the Vite dev server's websocket in development only.
 * There is no `unsafe-eval` and no remote origin: Bureau is offline-first and
 * the renderer has no business reaching the network. Mail HTML will be rendered
 * in a separate sandboxed frame with its own, stricter policy, never here.
 */
function contentSecurityPolicy(isDev: boolean): string {
	const connect = isDev ? `'self' ${DEV_URL} ws://localhost:5173` : "'self'";
	return [
		"default-src 'self'",
		// Vite injects styles as <style> tags in development, and Tailwind's
		// runtime does the same in the build.
		"style-src 'self' 'unsafe-inline'",
		"script-src 'self'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		`connect-src ${connect}`,
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
		// The one frame the app may show: a message body, on its own origin,
		// with its own policy. See main/scheme.ts.
		`frame-src ${MAIL_FRAME_ORIGIN}`,
	].join("; ");
}

export function createMainWindow(isDev: boolean): BrowserWindow {
	const window = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 940,
		minHeight: 600,
		show: false,
		backgroundColor: "#faf9f7",
		titleBarStyle: "hiddenInset",
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

	window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		// A message body arrives with its own, stricter policy from the scheme
		// handler. Stamping the application's policy on it too would add
		// frame-ancestors 'none' and block the very frame it is meant for.
		if (details.url.startsWith(`${MAIL_FRAME_ORIGIN}/`)) {
			callback({ responseHeaders: details.responseHeaders });
			return;
		}
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [contentSecurityPolicy(isDev)],
			},
		});
	});

	// Nothing in Bureau should ever open a second window, and a link in a note or
	// a client record must not be able to. External links go to the real browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://") || url.startsWith("mailto:")) void shell.openExternal(url);
		return { action: "deny" };
	});

	// Navigation away from the app is always a bug or an attack. Neither should
	// replace the interface.
	window.webContents.on("will-navigate", (event, url) => {
		const allowed = isDev ? DEV_URL : APP_ORIGIN;
		if (!url.startsWith(allowed)) event.preventDefault();
	});

	window.once("ready-to-show", () => window.show());

	void window.loadURL(isDev ? DEV_URL : `${APP_ORIGIN}/index.html`);

	return window;
}
