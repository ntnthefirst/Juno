/**
 * The lock secret, and nothing else.
 *
 * Rules this file exists to enforce (decision 15, .claude/rules/security.md):
 * - The secret is never stored. A scrypt verifier is.
 * - The verifier record is itself wrapped by Electron `safeStorage`, which is
 *   backed by Windows DPAPI and the macOS Keychain, so the file on disk is only
 *   readable by this OS user on this machine.
 * - Nothing here is ever returned across IPC. The renderer can ask to unlock; it
 *   can never read what it is unlocking against.
 * - `safeStorage` is unusable before `app.whenReady()`. Every entry point here
 *   checks, because calling it early hands back a buffer that decrypts to
 *   garbage later, which looks exactly like a wrong password.
 *
 * The decisions this file makes about cryptography and lockout live in
 * ./vault-core.ts, which is pure and tested. This module is only storage.
 */
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LockMethod } from "../shared/types";
import {
	KDF,
	activePenalty,
	deriveVerifier,
	newSalt,
	nextPenalty,
	remainingAttempts as coreRemaining,
	validateSecret,
	verifyAgainst,
	type KdfParams,
} from "./vault-core";

interface VaultRecord {
	v: 1;
	method: Exclude<LockMethod, "none">;
	kdf: KdfParams;
	salt: string;
	verifier: string;
	failedAttempts: number;
	lockedOutUntil: string | null;
}

let cache: VaultRecord | null | undefined;

function vaultPath(): string {
	return join(app.getPath("userData"), "lock.vault");
}

function assertReady(): void {
	if (!app.isReady()) {
		throw new Error("The vault was used before the app was ready. safeStorage is not usable yet.");
	}
}

function read(): VaultRecord | null {
	if (cache !== undefined) return cache;
	assertReady();
	const path = vaultPath();
	if (!existsSync(path)) {
		cache = null;
		return null;
	}
	try {
		cache = JSON.parse(safeStorage.decryptString(readFileSync(path))) as VaultRecord;
	} catch {
		// A vault that will not decrypt belongs to a different OS user or a
		// different machine. Treating it as absent would silently drop the lock, so
		// it stays an error the interface has to surface.
		throw new Error("The lock file exists but could not be read on this account.");
	}
	return cache;
}

function write(record: VaultRecord): void {
	assertReady();
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error("The operating system keychain is unavailable, so a lock cannot be stored.");
	}
	const path = vaultPath();
	mkdirSync(dirname(path), { recursive: true });
	// Written to a temp file and renamed, so a crash mid-write cannot leave a
	// truncated vault that locks the owner out permanently.
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(record)));
	renameSync(tmp, path);
	cache = record;
}

export function isConfigured(): boolean {
	return read() !== null;
}

export function configuredMethod(): LockMethod {
	return read()?.method ?? "none";
}

export function penaltyState(): { lockedOutUntil: string | null; failedAttempts: number } {
	const record = read();
	if (!record) return { lockedOutUntil: null, failedAttempts: 0 };
	return {
		lockedOutUntil: activePenalty(record),
		failedAttempts: record.failedAttempts,
	};
}

export function setSecret(
	method: Exclude<LockMethod, "none">,
	secret: string,
	currentSecret?: string,
): void {
	const existing = read();
	if (existing && !verifySecret(currentSecret ?? "")) {
		throw new Error("The current passphrase is wrong.");
	}
	validateSecret(method, secret);
	const salt = newSalt();
	write({
		v: 1,
		method,
		kdf: KDF,
		salt,
		verifier: deriveVerifier(secret, salt),
		failedAttempts: 0,
		lockedOutUntil: null,
	});
}

export function clearSecret(currentSecret: string): void {
	if (!read()) return;
	if (!verifySecret(currentSecret)) throw new Error("The current passphrase is wrong.");
	const path = vaultPath();
	if (existsSync(path)) unlinkSync(path);
	cache = null;
}

/**
 * Returns only a boolean. No part of the record leaves this module.
 * The stored KDF parameters are used rather than the current constant, so an
 * existing verifier still validates after the parameters are raised.
 */
export function verifySecret(secret: string): boolean {
	const record = read();
	if (!record) return false;
	return verifyAgainst(secret, record.salt, record.verifier, record.kdf);
}

export function recordFailure(): { lockedOutUntil: string | null; failedAttempts: number } {
	const record = read();
	if (!record) return { lockedOutUntil: null, failedAttempts: 0 };
	const next = nextPenalty(record);
	write({ ...record, ...next });
	return next;
}

export function recordSuccess(): void {
	const record = read();
	if (!record) return;
	if (record.failedAttempts === 0 && record.lockedOutUntil === null) return;
	write({ ...record, failedAttempts: 0, lockedOutUntil: null });
}

export function remainingAttempts(): number {
	const record = read();
	if (!record) return coreRemaining({ failedAttempts: 0, lockedOutUntil: null });
	return coreRemaining(record);
}

/** Test seam. Never called by application code. */
export function resetCacheForTests(): void {
	cache = undefined;
}
