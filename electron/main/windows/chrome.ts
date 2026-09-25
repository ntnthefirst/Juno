/**
 * What every Juno window shares: the content policy, the navigation rules and
 * the native window-control overlay.
 *
 * This lives apart from the windows themselves because the response-header hook
 * is installed on the *session*, not on a window. Registering it once per window
 * replaces the previous registration, so the second window silently un-does the
 * first window's policy. It is called once, before any window exists.
 */
import { app, BrowserWindow, nativeTheme, session, shell } from "electron";
import { join } from "node:path";
import { DEV_CSP_NONCE, DEV_URL, DEV_WS_URL } from "../../shared/dev";
import { ASSET_ORIGIN, MAIL_FRAME_ORIGIN } from "../../shared/types";
import { APP_ORIGIN } from "../scheme";

export { DEV_URL };

/**
 * Must match --titlebar-height in tokens.css. The renderer draws the bar and
 * the operating system draws the buttons on top of it, so a mismatch puts the
 * close button off the edge of the bar the user can see.
 */
export const TITLEBAR_HEIGHT = 41;

/**
 * The CSP the renderer runs under.
 *
 * `connect-src` allows the Vite dev server's websocket in development only.
 * There is no `unsafe-eval` and no remote origin: Juno is offline-first and the
 * renderer has no business reaching the network. Mail HTML is rendered in a
 * separate sandboxed frame with its own, stricter policy, never here.
 *
 * `script-src` gains a nonce in development and nothing else. Vite's React
 * plugin injects its refresh preamble inline, and a bare `'self'` blocks it,
 * which paints a white window and says so only in the renderer console. See
 * shared/dev.ts for why a nonce rather than `'unsafe-inline'`.
 */
function contentSecurityPolicy(isDev: boolean): string {
	const connect = isDev ? `'self' ${DEV_URL} ${DEV_WS_URL}` : "'self'";
	const script = isDev ? `'self' 'nonce-${DEV_CSP_NONCE}'` : "'self'";
	return [
		"default-src 'self'",
		// Vite injects styles as <style> tags in development, and Tailwind's
		// runtime does the same in the build.
		"style-src 'self' 'unsafe-inline'",
		`script-src ${script}`,
		// app://asset serves one thing, the bytes of a project file that is an
		// image, and only ever as the source of an <img>. It is a separate origin
		// so a file that turns out not to be one cannot become a document.
		`img-src 'self' data: blob: ${ASSET_ORIGIN}`,
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

/** Called once, before the first window. Applies to every window after it. */
export function installSessionPolicy(isDev: boolean): void {
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		// A message body and a project thumbnail each arrive with their own,
		// stricter policy from the scheme handler. Stamping the application's
		// policy over a message body would add frame-ancestors 'none' and block
		// the very frame it is meant for, and over a thumbnail it would replace
		// `default-src 'none'` with something broader.
		if (
			details.url.startsWith(`${MAIL_FRAME_ORIGIN}/`) ||
			details.url.startsWith(`${ASSET_ORIGIN}/`)
		) {
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
}

/**
 * The colours the operating system paints the caption buttons with. They are
 * read from the resolved theme rather than from the renderer, because the
 * overlay is drawn by the OS before any React has run.
 *
 * These are the --paper and --ink-muted values from tokens.css. They cannot be
 * `var(--paper)`: this is a native surface, not a document.
 */
export function overlayColors(): { color: string; symbolColor: string; height: number } {
	const dark = nativeTheme.shouldUseDarkColors;
	return {
		color: dark ? "#111117" : "#f6f6fa",
		symbolColor: dark ? "#a3a4b5" : "#5d5e70",
		height: TITLEBAR_HEIGHT,
	};
}

/**
 * Repaints the caption buttons on every open window. Called when the theme
 * changes, because the overlay keeps the colour it was created with otherwise
 * and a light close button sits on a dark bar.
 */
export function refreshOverlayTheme(): void {
	if (process.platform === "darwin") return;
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		try {
			window.setTitleBarOverlay(overlayColors());
		} catch {
			// A window created without an overlay throws rather than no-ops. That
			// is not an error worth surfacing: it only means this window draws its
			// own controls.
		}
	}
}

/**
 * The title bar options for a window that draws its own bar. On macOS the
 * traffic lights are inset over the bar; everywhere else the OS paints an
 * overlay we colour to match.
 */
export function titleBarOptions(): Electron.BrowserWindowConstructorOptions {
	if (process.platform === "darwin") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: (TITLEBAR_HEIGHT - 16) / 2 },
		};
	}
	return { titleBarStyle: "hidden", titleBarOverlay: overlayColors() };
}

/**
 * The window icon, and only in development.
 *
 * A packaged build takes its icon from the executable, which electron-builder
 * stamps from build/icon.png. An unpackaged run has no executable of its own,
 * so it inherits Electron's default, and every development window and taskbar
 * entry shows Electron's logo instead of Juno's. Pointing at the same source
 * file fixes the run nobody packages.
 *
 * `build/` is not in the builder's `files`, so the path exists only when it is
 * used. Returning undefined rather than a missing path keeps a packaged window
 * on the executable's icon rather than on nothing.
 */
export function windowIcon(): string | undefined {
	if (app.isPackaged) return undefined;
	return join(app.getAppPath(), "build", "icon.png");
}

/**
 * The dock icon on macOS, which ignores a window's `icon` entirely. Same
 * reasoning as windowIcon: a packaged build carries it in the bundle.
 */
export function applyDevDockIcon(): void {
	if (process.platform !== "darwin" || app.isPackaged || !app.dock) return;
	const icon = windowIcon();
	if (icon) app.dock.setIcon(icon);
}

/**
 * Link handling and navigation, applied to every window.
 *
 * Nothing in Juno should open a second window of its own accord, and a link in
 * a note, a client record or a message must not be able to. External links go
 * to the real browser, and only over a protocol that cannot execute anything.
 */
export function hardenWindow(window: BrowserWindow, isDev: boolean): void {
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
}

/**
 * Where a window loads its renderer from, with the view it should render.
 *
 * The view rides in the hash so the renderer can read it synchronously and
 * paint the right shell on the first frame, rather than asking over IPC and
 * flashing the wrong one. `section` is the settings tab to open on, which is
 * how "connect a mail account" reaches the right page from the main window.
 */
export function viewUrl(isDev: boolean, view: "main" | "settings" | "setup", section?: string): string {
	const base = isDev ? `${DEV_URL}/` : `${APP_ORIGIN}/index.html`;
	if (view === "main") return base;
	return section ? `${base}#/${view}/${section}` : `${base}#/${view}`;
}
