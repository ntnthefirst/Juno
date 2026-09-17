/**
 * Refuses every IPC channel while the app is locked.
 *
 * Why this is a wrapper rather than a check inside each handler: a handler that
 * forgets the check is a silent hole, and there will be dozens of handlers. This
 * way a new channel is guarded by default and has to be named explicitly to be
 * allowed through, which is the correct direction for the mistake to fall.
 *
 * `installLockGuard()` must run BEFORE any `register*Ipc()` call, because it
 * replaces `ipcMain.handle` for the handlers registered after it.
 *
 * Decision 15: lock state is owned by the main process. The renderer being
 * convinced it is unlocked means nothing here.
 */
import { ipcMain } from "electron";
import { isLocked } from "../services/lock";

/**
 * The only channels a locked app answers. Each one either drives the lock screen
 * itself or is needed to render it correctly.
 *
 * Nothing that touches business data belongs here, ever.
 */
const ALLOWED_WHILE_LOCKED = new Set([
	"app.info",
	"lock.state",
	"lock.unlock",
	"lock.getSettings",
	"settings.getTheme",
]);

export class LockedError extends Error {
	readonly code = "BUREAU_LOCKED";
	constructor(channel: string) {
		super(`Bureau is locked, so ${channel} was refused.`);
		this.name = "LockedError";
	}
}

let installed = false;

export function installLockGuard(): void {
	if (installed) return;
	installed = true;

	const original = ipcMain.handle.bind(ipcMain);

	ipcMain.handle = ((
		channel: string,
		listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
	) => {
		return original(channel, async (event, ...args) => {
			if (isLocked() && !ALLOWED_WHILE_LOCKED.has(channel)) {
				throw new LockedError(channel);
			}
			return listener(event, ...args);
		});
	}) as typeof ipcMain.handle;
}

/** Exported so a test can assert the allow-list has not quietly grown. */
export function allowedWhileLocked(): string[] {
	return [...ALLOWED_WHILE_LOCKED].sort();
}
