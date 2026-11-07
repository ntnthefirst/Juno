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
	// Pictures for the native menus. They carry no data and are sent while Juno is still locked.
	"menu.setIcons",
]);

export class LockedError extends Error {
	readonly code = "JUNO_LOCKED";
	constructor(channel: string) {
		super(`Juno is locked, so ${channel} was refused.`);
		this.name = "LockedError";
	}
}

let installed = false;

type IpcTiming = { channel: string; count: number; total: number; max: number };
let timings: Map<string, IpcTiming> | null = null;

function record(channel: string, ms: number): void {
	if (!timings) return;
	const entry = timings.get(channel) ?? { channel, count: 0, total: 0, max: 0 };
	entry.count += 1;
	entry.total += ms;
	entry.max = Math.max(entry.max, ms);
	timings.set(channel, entry);
}

/**
 * Starts counting how long each channel's handler takes, for the smoke run's
 * timings. The handlers run on the main process, and node:sqlite is
 * synchronous, so this is the time the window could not get an answer to
 * anything else. Returns a function that stops counting and hands back the
 * channels, slowest in total first. Off unless asked for.
 */
export function startIpcTimings(): () => IpcTiming[] {
	timings = new Map();
	return () => {
		const result = [...(timings?.values() ?? [])].sort((a, b) => b.total - a.total);
		timings = null;
		return result;
	};
}

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
			if (!timings) return listener(event, ...args);
			const started = performance.now();
			try {
				return await listener(event, ...args);
			} finally {
				record(channel, performance.now() - started);
			}
		});
	}) as typeof ipcMain.handle;
}

/** Exported so a test can assert the allow-list has not quietly grown. */
export function allowedWhileLocked(): string[] {
	return [...ALLOWED_WHILE_LOCKED].sort();
}
