/**
 * Updates, from the public GitHub releases the release workflow publishes.
 *
 * Deliberately quiet. Juno is a local-first application someone works in all
 * day, so an update never interrupts, never restarts on its own, and never
 * downloads while the app is locked. It checks on a slow interval, and it
 * installs when Juno is closed, so the next launch is the new version.
 *
 * This is the only outbound network call Juno makes that is not a mail account
 * the user configured, which is why it is one small file that says so.
 *
 * What is compared is the release feed, not the tag list. A tag with no
 * published release has no installer behind it and nothing to verify, so a
 * build that exists only as a tag is invisible here on purpose.
 */
import { app } from "electron";
// The named import, not the default one. electron-updater is CommonJS, and the
// main process compiles to CommonJS too, so a default import resolves to an
// undefined `.default` and throws on the first line that touches it.
import { autoUpdater } from "electron-updater";
import type { UpdateStage, UpdateStatus } from "../../shared/types";
import { isLocked } from "./lock";
import * as settings from "./settings";
import { allowManualCheck, MANUAL_LIMIT, nextCheckDelay } from "./update-policy";

type Listener = (status: UpdateStatus) => void;

const listeners = new Set<Listener>();

let stage: UpdateStage = "idle";
let newVersion: string | null = null;
let releasedAt: string | null = null;
let percent = 0;
let failure: string | null = null;
let lastCheckedAt: string | null = null;
let nextCheckAt: string | null = null;
let autoInstall = true;
/** Timestamps of the manual checks still inside the rate-limit window. */
let manualChecks: number[] = [];
let timer: NodeJS.Timeout | null = null;
let wired = false;
/** Set by a person pressing Install, so the download restarts the app when it lands. */
let installWhenReady = false;

/**
 * The updater only works from a packaged build: an unpackaged run has no
 * signature and no version to compare, and it throws rather than no-ops. The
 * settings screen still draws, and says so.
 */
function supported(): boolean {
	return app.isPackaged;
}

export function status(): UpdateStatus {
	return {
		stage: supported() ? stage : "unsupported",
		currentVersion: app.getVersion(),
		newVersion,
		releasedAt,
		percent,
		lastCheckedAt,
		nextCheckAt,
		autoInstall,
		error: stage === "error" ? failure : null,
	};
}

export function onChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function broadcast(): void {
	const current = status();
	for (const listener of listeners) listener(current);
}

function setStage(next: UpdateStage): void {
	stage = next;
	if (next !== "error") failure = null;
	if (next !== "downloading") percent = 0;
	broadcast();
}

/**
 * An update error is not something the user can act on beyond trying again, and
 * the thrown object carries the feed URL and the request behind it. The class
 * name is the most that may be repeated back (.claude/rules/security.md).
 */
function fail(cause: unknown): void {
	const text = cause instanceof Error ? cause.message : String(cause);
	const name = cause instanceof Error ? cause.name : "Error";

	if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ENETDOWN|net::/i.test(text)) {
		failure = "Could not reach GitHub to look for a release. Check your connection and try again.";
	} else if (/\b404\b|No published versions|Unable to find latest version/i.test(text)) {
		failure = "No published release was found to compare against. There may not be one yet.";
	} else {
		failure = `The update failed (${name}). Try again in a moment.`;
	}

	stage = "error";
	percent = 0;
	broadcast();
}

function ensureWired(): void {
	if (wired) return;
	wired = true;

	applyAutoInstall();

	autoUpdater.on("error", (error: Error) => fail(error));

	autoUpdater.on("update-available", (info: { version: string; releaseDate?: string }) => {
		newVersion = info.version;
		releasedAt = info.releaseDate ?? null;
		// autoDownload starts on its own when auto-install is on, and the first
		// progress event moves this on. Until then "available" is the truth.
		setStage("available");
	});

	autoUpdater.on("update-not-available", () => {
		newVersion = null;
		releasedAt = null;
		setStage("current");
	});

	autoUpdater.on("download-progress", (progress: { percent: number }) => {
		percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
		stage = "downloading";
		broadcast();
	});

	autoUpdater.on("update-downloaded", (info: { version: string }) => {
		newVersion = info.version;
		setStage("ready");
		// Only when a person pressed Install. Otherwise it waits for the close,
		// because losing a half-written client record to an update is not a trade
		// worth making.
		if (installWhenReady) {
			installWhenReady = false;
			restart();
		}
	});
}

function applyAutoInstall(): void {
	// Two properties, one setting. autoDownload false means a found update sits
	// there until somebody asks for it; autoInstallOnAppQuit false means a
	// download that did happen is not applied behind their back either.
	autoUpdater.autoDownload = autoInstall;
	autoUpdater.autoInstallOnAppQuit = autoInstall;
}

function schedule(): void {
	if (timer) clearTimeout(timer);
	if (!supported()) {
		nextCheckAt = null;
		return;
	}

	const delay = nextCheckDelay(lastCheckedAt, Date.now());
	nextCheckAt = new Date(Date.now() + delay).toISOString();
	timer = setTimeout(() => {
		void (async () => {
			// Locked means nobody is at the keyboard. Nothing unattended runs then,
			// and that includes this (decision 15). The next window comes round on
			// its own, so a locked machine is a skipped check, not a missed one.
			if (!isLocked()) {
				await check().catch(() => undefined);
			}
			lastCheckedAt = new Date().toISOString();
			await settings.setUpdates({ lastCheckedAt });
			schedule();
		})();
	}, delay);
	timer.unref?.();
}

/**
 * Loads the stored preference and arms the interval. Called on every launch,
 * including a development one: an unpackaged run reads the setting so the
 * settings window draws the toggle correctly, and schedules nothing.
 */
export async function startUpdates(): Promise<void> {
	const stored = await settings.getUpdates();
	autoInstall = stored.autoInstall;
	lastCheckedAt = stored.lastCheckedAt;

	if (!supported()) {
		broadcast();
		return;
	}

	ensureWired();
	schedule();
}

export function stopUpdates(): void {
	if (timer) clearTimeout(timer);
	timer = null;
}

function requireSupported(): void {
	if (!supported()) {
		throw new Error("This is a development build, so there is no release to compare it against.");
	}
}

/**
 * Looks for a newer release.
 *
 * `manual` is what a person pressing the button passes, and it is the only
 * thing the rate limit applies to. The interval checks itself and does not
 * spend a person's budget doing it.
 */
export async function check(options: { manual?: boolean } = {}): Promise<UpdateStatus> {
	requireSupported();

	if (options.manual) {
		const verdict = allowManualCheck(manualChecks, Date.now());
		if (!verdict.allowed) {
			const seconds = Math.ceil(verdict.retryAfterMs / 1000);
			throw new Error(
				`Juno checks for updates at most ${MANUAL_LIMIT} times a minute. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
			);
		}
		manualChecks = verdict.recent;
		lastCheckedAt = new Date().toISOString();
		await settings.setUpdates({ lastCheckedAt });
	}

	// Already busy. Asking again would not answer sooner and a second download
	// of the same file is the one thing the rate limit is there to prevent.
	const busy: boolean = stage === "checking" || stage === "downloading";
	if (busy) return status();

	ensureWired();
	setStage("checking");
	try {
		await autoUpdater.checkForUpdates();
		// Neither event fired, which electron-updater does not promise but has
		// done. Nothing newer was found is the only reading that is not a guess.
		if (stage === "checking") setStage("current");
	} catch (cause: unknown) {
		fail(cause);
	}

	if (options.manual) schedule();
	return status();
}

/**
 * Downloads the found update if it is not downloaded yet, then restarts into
 * it. This is the manual path: with auto-install on, nothing here is needed.
 */
export async function install(): Promise<UpdateStatus> {
	requireSupported();

	if (stage === "ready") {
		restart();
		return status();
	}
	if (stage === "downloading") {
		// Already coming down on its own. Press Install and it restarts when it
		// lands rather than waiting for the close.
		installWhenReady = true;
		return status();
	}
	if (stage !== "available") {
		throw new Error("There is no update to install. Check for updates first.");
	}

	await download({ thenRestart: true });
	return status();
}

/**
 * `thenRestart` is the whole difference between the two ways an update is
 * fetched. A person pressing Install wants the new version now; auto-install
 * wants it on disk and applied at the next close, which is what
 * autoInstallOnAppQuit does without anything here asking.
 */
async function download(options: { thenRestart: boolean }): Promise<void> {
	ensureWired();
	installWhenReady = options.thenRestart;
	setStage("downloading");
	try {
		await autoUpdater.downloadUpdate();
	} catch (cause: unknown) {
		installWhenReady = false;
		fail(cause);
	}
}

/**
 * Not inside the call that asked for it. quitAndInstall tears the window down,
 * so the IPC reply has to be on its way out first or the renderer is left
 * waiting on a channel that no longer has anything behind it.
 */
function restart(): void {
	setTimeout(() => autoUpdater.quitAndInstall(), 100);
}

export async function setAutoInstall(value: boolean): Promise<UpdateStatus> {
	autoInstall = value;
	await settings.setUpdates({ autoInstall: value });
	if (supported()) {
		ensureWired();
		applyAutoInstall();
		// Turned on while an update was sitting there unfetched. Nothing else
		// would start it until the next check, 38 hours out. It still installs
		// at the next close rather than now: turning a setting on is not asking
		// to be restarted.
		if (value && stage === "available") void download({ thenRestart: false });
	}
	broadcast();
	return status();
}
