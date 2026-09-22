/**
 * Lock state, owned by the main process.
 *
 * Decision 15: a renderer that believes it is unlocked is not evidence of
 * anything. The boolean below is the only authority, the guard in
 * ../ipc/lock-guard.ts enforces it on every channel, and the renderer is merely
 * told what happened.
 *
 * What this protects: someone using the machine while Juno is running. It does
 * not encrypt the file on disk, and the settings screen has to say so.
 */
import { BrowserWindow, powerMonitor } from "electron";
import type { LockSettings, LockState, UnlockResult } from "../../shared/types";
import * as vault from "../vault";

type Listener = (state: LockState) => void;

const listeners = new Set<Listener>();
let locked = false;
let idleTimer: NodeJS.Timeout | null = null;
let settings: LockSettings = {
	method: "none",
	idleMinutes: 15,
	lockOnSleep: true,
	lockOnMinimise: false,
};

export function state(): LockState {
	const penalty = vault.penaltyState();
	return {
		configured: vault.isConfigured(),
		locked,
		method: vault.configuredMethod(),
		lockedOutUntil: penalty.lockedOutUntil,
		failedAttempts: penalty.failedAttempts,
	};
}

export function isLocked(): boolean {
	return locked;
}

function broadcast(): void {
	const current = state();
	for (const listener of listeners) listener(current);
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send("lock.changed", current);
	}
}

export function onChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function lock(): LockState {
	if (!vault.isConfigured()) return state();
	if (!locked) {
		locked = true;
		stopIdleTimer();
		broadcast();
	}
	return state();
}

export function unlock(secret: string): UnlockResult {
	if (!vault.isConfigured()) return { ok: false, reason: "not-configured" };

	const penalty = vault.penaltyState();
	if (penalty.lockedOutUntil && Date.parse(penalty.lockedOutUntil) > Date.now()) {
		return { ok: false, reason: "rate-limited", lockedOutUntil: penalty.lockedOutUntil };
	}

	if (!vault.verifySecret(secret)) {
		const after = vault.recordFailure();
		broadcast();
		return {
			ok: false,
			reason: "wrong-secret",
			lockedOutUntil: after.lockedOutUntil,
			remainingAttempts: vault.remainingAttempts(),
		};
	}

	vault.recordSuccess();
	locked = false;
	restartIdleTimer();
	broadcast();
	return { ok: true };
}

export function configure(input: {
	method: "passphrase" | "pin";
	secret: string;
	currentSecret?: string;
}): LockState {
	vault.setSecret(input.method, input.secret, input.currentSecret);
	settings = { ...settings, method: input.method };
	locked = false;
	restartIdleTimer();
	broadcast();
	return state();
}

export function disable(currentSecret: string): LockState {
	vault.clearSecret(currentSecret);
	settings = { ...settings, method: "none" };
	locked = false;
	stopIdleTimer();
	broadcast();
	return state();
}

export function getSettings(): LockSettings {
	return { ...settings, method: vault.configuredMethod() };
}

export function applySettings(patch: Partial<LockSettings>): LockSettings {
	settings = { ...settings, ...patch };
	restartIdleTimer();
	return getSettings();
}

/* ------------------------------------------------------------ idle and sleep */

function stopIdleTimer(): void {
	if (idleTimer) clearInterval(idleTimer);
	idleTimer = null;
}

function restartIdleTimer(): void {
	stopIdleTimer();
	if (!vault.isConfigured() || settings.idleMinutes <= 0 || locked) return;
	// powerMonitor reports real system idle, so a user reading a long document in
	// another window still counts as away, and a video playing does not.
	idleTimer = setInterval(() => {
		if (locked) return;
		if (powerMonitor.getSystemIdleTime() >= settings.idleMinutes * 60) lock();
	}, 15_000);
}

/**
 * Called once from main.ts after the app is ready. Starts locked whenever a
 * secret is configured, so the first thing a launch shows is the lock screen.
 */
export function start(initial: LockSettings): void {
	settings = initial;
	locked = vault.isConfigured();

	powerMonitor.on("suspend", () => {
		if (settings.lockOnSleep) lock();
	});
	powerMonitor.on("lock-screen", () => {
		if (settings.lockOnSleep) lock();
	});

	restartIdleTimer();
}

export function watchWindow(window: BrowserWindow): void {
	window.on("minimize", () => {
		if (settings.lockOnMinimise) lock();
	});
}

/** Test seam. Never called by application code. */
export function resetForTests(): void {
	locked = false;
	stopIdleTimer();
	listeners.clear();
}
