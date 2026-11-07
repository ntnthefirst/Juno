/**
 * The Windows half of the desktop integration: the tray icon, the badge on the
 * taskbar button and the global shortcut. What each of them decides is in
 * services/desktop.ts and services/background.ts. This file draws them.
 *
 * Windows only, behind one check. There is no version of this for another
 * platform and none is stubbed.
 */
import { join } from "node:path";
import { app, globalShortcut, Menu, nativeImage, Tray } from "electron";
import * as agentActions from "./services/agent-actions";
import { badgePng } from "./services/badge-image";
import * as desktop from "./services/desktop";
import * as lock from "./services/lock";
import * as settings from "./services/settings";
import { focusMainWindow, getMainWindow, openMainWindow, requestShell } from "./windows";

export const isWindows = process.platform === "win32";

let tray: Tray | null = null;
let badgeShown = 0;
let badgeRun = 0;
let stopListening: (() => void) | null = null;

/** Whether the tray icon exists, for the smoke run to read. */
export function trayExists(): boolean {
	return tray !== null && !tray.isDestroyed();
}

/** The count last drawn on the taskbar button, for the smoke run to read. */
export function badgeCount(): number {
	return badgeShown;
}

export function openJuno(isDev: boolean): void {
	if (getMainWindow()) focusMainWindow();
	else openMainWindow(isDev);
}

/**
 * Creates or removes the icon. A tray is not Windows-specific, and Juno running in
 * the background (decision 52) needs one on any platform it runs on.
 * `wanted` is the tray setting or running in the
 * background, whichever is on: a process with no window and no icon could not
 * be found again.
 */
export function syncTray(wanted: boolean, isDev: boolean): void {
	if (!wanted) {
		destroyTray();
		return;
	}
	if (trayExists()) return;

	const image = nativeImage.createFromPath(join(app.getAppPath(), "build", "icon.png")).resize({ width: 16, height: 16 });
	tray = new Tray(image);
	tray.setToolTip("Juno");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Juno", click: () => openJuno(isDev) },
			{ label: "New note", click: () => void desktop.newNote() },
			{ type: "separator" },
			// Quits for real: the keep-running setting only decides what closing the
			// window does, and this is not closing the window.
			{ label: "Quit Juno", click: () => app.quit() },
		]),
	);
	tray.on("click", () => openJuno(isDev));
}

/** On quit, before anything else, so the icon is not left behind in the notification area. */
export function destroyTray(): void {
	if (tray && !tray.isDestroyed()) tray.destroy();
	tray = null;
}

/**
 * Draws the number of requests waiting on the taskbar button, or clears it.
 * Called from the change event of the requests, never from a timer.
 */
export async function syncBadge(): Promise<void> {
	if (!isWindows) return;
	const run = ++badgeRun;
	const wanted = (await settings.getDesktop()).badge;
	const count = wanted ? await agentActions.pendingCount() : 0;
	// A slower earlier answer must not overwrite the newer one.
	if (run !== badgeRun) return;
	badgeShown = count;
	const window = getMainWindow();
	if (!window) return;
	if (count === 0) {
		window.setOverlayIcon(null, "");
		return;
	}
	const image = nativeImage.createFromBuffer(badgePng(count));
	window.setOverlayIcon(image, `${count} agent request${count === 1 ? "" : "s"} waiting`);
}

/**
 * Starts following the requests. The badge changes when one is made, answered or
 * expires. A window made later has no overlay yet, so whoever opens one calls
 * `syncBadge` once it can paint.
 */
export function startBadge(): void {
	if (!isWindows || stopListening) return;
	stopListening = agentActions.onChange(() => void syncBadge());
}

export function stopBadge(): void {
	stopListening?.();
	stopListening = null;
}

/** The ports the desktop service works through. */
export function desktopPorts(isDev: boolean, syncSurfaces: () => void | Promise<void>): desktop.DesktopPorts {
	return {
		supported: isWindows,
		isLocked: () => lock.isLocked(),
		focusWindow: () => openJuno(isDev),
		requestShell,
		registerShortcut: (accelerator, run) => {
			try {
				return globalShortcut.register(accelerator, run);
			} catch {
				return false;
			}
		},
		releaseShortcut: (accelerator) => globalShortcut.unregister(accelerator),
		syncSurfaces,
	};
}

/** On quit: nothing registered with the operating system outlives Juno. */
export function releaseDesktop(): void {
	desktop.releaseShortcut();
	globalShortcut.unregisterAll();
	stopBadge();
	destroyTray();
}
