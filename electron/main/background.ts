/**
 * The electron half of running in the background: the login item and the tray
 * icon. What decides it is in services/background.ts.
 *
 * The login item starts the installed Juno with `--background`, which brings
 * up the database and the agent server and opens no window. The tray icon is
 * the only sign it is there: it opens the window or quits. Closing the window
 * does not quit while this is on, which is the point of it.
 */
import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import * as settings from "./services/settings";
import { shouldRunInBackground, startsWithoutWindow } from "./services/background";

let tray: Tray | null = null;
let running = false;
let openWindow: () => void = () => undefined;

/** Read by `window-all-closed`, which cannot wait for the settings file. */
export function runsInBackground(): boolean {
	return running;
}

export function configureBackground(open: () => void): void {
	openWindow = open;
}

async function decide(): Promise<boolean> {
	const stored = await settings.get();
	return shouldRunInBackground({
		packaged: app.isPackaged,
		smoke: Boolean(process.env.JUNO_SMOKE),
		serverEnabled: stored.mcpServer.enabled,
		background: stored.mcpServer.background,
		setupDone: stored.onboarding.completedAt !== null,
	});
}

/** Brings the login item and the tray icon in line with the settings. Safe to call at any time. */
export async function syncBackground(): Promise<void> {
	running = await decide();

	// Linux has no login item API here; the call is a no-op rather than an error.
	if (app.isPackaged && !process.env.JUNO_SMOKE) {
		app.setLoginItemSettings({ openAtLogin: running, openAsHidden: true, args: ["--background"] });
	}

	if (!running) {
		tray?.destroy();
		tray = null;
		return;
	}
	if (tray) return;

	const image = nativeImage.createFromPath(join(app.getAppPath(), "build", "icon.png")).resize({ width: 16, height: 16 });
	tray = new Tray(image);
	tray.setToolTip("Juno");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Juno", click: () => openWindow() },
			{ type: "separator" },
			{ label: "Quit Juno", click: () => app.quit() },
		]),
	);
	tray.on("click", () => openWindow());
}

/** The decision for a launch, taken before any window exists. */
export async function launchedHidden(): Promise<boolean> {
	const openedAsHidden = process.platform === "darwin" ? app.getLoginItemSettings().wasOpenedAsHidden : false;
	return startsWithoutWindow({ argv: process.argv, openedAsHidden, background: await decide() });
}
