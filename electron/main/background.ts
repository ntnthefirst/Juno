/**
 * The electron half of running in the background: the login item and the tray
 * icon. What decides it is in services/background.ts.
 *
 * The login item starts the installed Juno with `--background`, which brings
 * up the database and the agent server and opens no window. The tray icon is
 * the only sign it is there: it opens the window or quits. Closing the window
 * does not quit while this is on, which is the point of it. The icon itself
 * is drawn by tray.ts, which also keeps it when the tray setting asks for it.
 */
import { app } from "electron";
import * as settings from "./services/settings";
import { shouldRunInBackground, startsWithoutWindow } from "./services/background";
import { destroyTray, isWindows, syncTray } from "./tray";

let running = false;
let devRun = false;

/** Read by `window-all-closed`, which cannot wait for the settings file. */
export function runsInBackground(): boolean {
	return running;
}

export function configureBackground(isDev: boolean): void {
	devRun = isDev;
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

	// The icon stays while Juno runs without a window, whatever the tray setting
	// says: a process nobody can see or quit would be a bug, not a preference.
	const wanted = running || (isWindows && (await settings.getDesktop()).tray);
	if (wanted) syncTray(true, devRun);
	else destroyTray();
}

/** The decision for a launch, taken before any window exists. */
export async function launchedHidden(): Promise<boolean> {
	const openedAsHidden = process.platform === "darwin" ? app.getLoginItemSettings().wasOpenedAsHidden : false;
	return startsWithoutWindow({ argv: process.argv, openedAsHidden, background: await decide() });
}
