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
 */
import { app, safeStorage } from "electron";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LockMethod } from "../shared/types";

/**
 * scrypt rather than Argon2id, per decision 17: Argon2 needs a native module and
 * this project deliberately has none. The parameters are stored alongside the
 * verifier so they can be raised, or the algorithm swapped, without guessing
 * what produced an existing record.
 */
const KDF = { name: "scrypt" as const, N: 2 ** 15, r: 8, p: 1, keylen: 64 };

/** Five wrong tries, then a delay that doubles from 30 seconds up to 15 minutes. */
const FREE_ATTEMPTS = 5;
const FIRST_PENALTY_MS = 30_000;
const MAX_PENALTY_MS = 15 * 60_000;

interface VaultRecord {
	v: 1;
	method: Exclude<LockMethod, "none">;
	kdf: typeof KDF;
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

function derive(secret: string, salt: Buffer): Buffer {
	return scryptSync(secret, salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p });
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
		const raw = safeStorage.decryptString(readFileSync(path));
		cache = JSON.parse(raw) as VaultRecord;
	} catch {
		// A vault that cannot be decrypted is a vault from a different OS user or a
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
	// An expired penalty is reported as absent rather than rewritten here, so that
	// reading state never writes to disk.
	const until = record.lockedOutUntil;
	const expired = until !== null && Date.parse(until) <= Date.now();
	return {
		lockedOutUntil: expired ? null : until,
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
	if (method === "pin" && !/^\d{4,12}$/.test(secret)) {
		throw new Error("A PIN has to be 4 to 12 digits.");
	}
	if (method === "passphrase" && secret.length < 8) {
		throw new Error("A passphrase has to be at least 8 characters.");
	}
	const salt = randomBytes(32);
	write({
		v: 1,
		method,
		kdf: KDF,
		salt: salt.toString("base64"),
		verifier: derive(secret, salt).toString("base64"),
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
 * Constant-time comparison against the stored verifier. Returns only a boolean:
 * no part of the record leaves this module.
 */
export function verifySecret(secret: string): boolean {
	const record = read();
	if (!record) return false;
	const expected = Buffer.from(record.verifier, "base64");
	const actual = derive(secret, Buffer.from(record.salt, "base64"));
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function recordFailure(): { lockedOutUntil: string | null; failedAttempts: number } {
	const record = read();
	if (!record) return { lockedOutUntil: null, failedAttempts: 0 };
	const failedAttempts = record.failedAttempts + 1;
	let lockedOutUntil: string | null = null;
	if (failedAttempts > FREE_ATTEMPTS) {
		const over = failedAttempts - FREE_ATTEMPTS - 1;
		const penalty = Math.min(FIRST_PENALTY_MS * 2 ** over, MAX_PENALTY_MS);
		lockedOutUntil = new Date(Date.now() + penalty).toISOString();
	}
	write({ ...record, failedAttempts, lockedOutUntil });
	return { lockedOutUntil, failedAttempts };
}

export function recordSuccess(): void {
	const record = read();
	if (!record) return;
	if (record.failedAttempts === 0 && record.lockedOutUntil === null) return;
	write({ ...record, failedAttempts: 0, lockedOutUntil: null });
}

export function remainingAttempts(): number {
	const record = read();
	if (!record) return FREE_ATTEMPTS;
	return Math.max(0, FREE_ATTEMPTS - record.failedAttempts);
}

/** Test seam. Never called by application code. */
export function resetCacheForTests(): void {
	cache = undefined;
}
