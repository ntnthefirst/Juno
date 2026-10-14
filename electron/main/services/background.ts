/**
 * Whether Juno should stay running with no window, and whether a launch
 * should skip the window.
 *
 * An agent reaches Juno through the agent server, and that server lives in
 * this process. A client such as Claude Desktop starts its own helper that
 * forwards to it, and says "Juno is not running" when nobody opened the app.
 * So by default Juno starts with the computer, comes up without a window and
 * keeps running when the window is closed. The tray icon opens it or quits it.
 *
 * Pure: no Electron import, so the rules are tested without an app.
 */

export type BackgroundInputs = {
	/** An unpackaged run has no installed copy to start at login, and a dev server is not left behind. */
	packaged: boolean;
	/** A smoke run opens, looks and exits. */
	smoke: boolean;
	/** The agent server is switched on. Without it there is nothing to keep running for. */
	serverEnabled: boolean;
	/** The background setting. */
	background: boolean;
	/** Setup has been finished. Until then a closed window quits, because the install has no name yet. */
	setupDone: boolean;
};

/** Stay running when the last window closes, and start with the computer. */
export function shouldRunInBackground(input: BackgroundInputs): boolean {
	return input.packaged && !input.smoke && input.serverEnabled && input.background && input.setupDone;
}

/**
 * Whether this launch was the operating system starting Juno at login. The
 * window stays down then, and comes up when the person opens Juno.
 */
export function startsWithoutWindow(input: { argv: string[]; openedAsHidden: boolean; background: boolean }): boolean {
	return input.background && (input.argv.includes("--background") || input.openedAsHidden);
}
