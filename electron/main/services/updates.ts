/**
 * Automatic updates, from the public GitHub releases the release workflow
 * publishes.
 *
 * Deliberately quiet. Juno is a local-first application someone works in all
 * day, so an update never interrupts, never restarts on its own, and never
 * downloads while the app is locked. It checks, it downloads in the background,
 * and it installs on the next quit.
 *
 * This is the only outbound network call Juno makes that is not a mail account
 * the user configured, which is why it is one small file that says so.
 */
import { app } from "electron";
// The named import, not the default one. electron-updater is CommonJS, and the
// main process compiles to CommonJS too, so a default import resolves to an
// undefined `.default` and throws on the first line that touches it.
import { autoUpdater } from "electron-updater";
import { isLocked } from "./lock";

/** Once on launch, then daily. A back office is left open for days at a time. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

export function startUpdates(): void {
	// The updater only works from a packaged build: an unpackaged run has no
	// signature and no version to compare, and it throws rather than no-ops.
	if (!app.isPackaged) return;

	// Installed on quit, not mid-session. Losing a half-written client record to
	// an update prompt is not a trade worth making.
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("error", (error: Error) => {
		// An update that cannot be reached is not an error the user can act on,
		// and Juno is expected to run offline. Log the class, never the request.
		console.warn(`Update check failed: ${error.name}`);
	});

	autoUpdater.on("update-downloaded", (info: { version: string }) => {
		console.log(`Update ${info.version} downloaded. It installs on the next quit.`);
	});

	const check = () => {
		// Locked means nobody is at the keyboard. Nothing unattended runs then,
		// and that includes this (decision 15).
		if (isLocked()) return;
		void autoUpdater.checkForUpdates()?.catch(() => undefined);
	};

	// Not immediately: the first thirty seconds after launch belong to opening
	// the mailbox and painting the day, not to a download.
	setTimeout(check, FIRST_CHECK_DELAY_MS);
	timer = setInterval(check, CHECK_INTERVAL_MS);
	timer.unref?.();
}

export function stopUpdates(): void {
	if (timer) clearInterval(timer);
	timer = null;
}
