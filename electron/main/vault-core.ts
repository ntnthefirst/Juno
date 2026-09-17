/**
 * The parts of the lock that are pure computation: deriving a verifier, checking
 * one, and working out the penalty after a failed attempt.
 *
 * Split out from vault.ts so it can be tested. vault.ts imports `electron` for
 * `safeStorage` and `app.getPath`, and the test runner is plain Node, so
 * anything living there cannot be exercised at all. Given this is the code that
 * decides whether a wrong passphrase gets in, that was not an acceptable place
 * to leave untested.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * scrypt rather than Argon2id, per decision 17: Argon2 needs a native module and
 * this project deliberately has none. Parameters travel with the record so they
 * can be raised, or the algorithm swapped, without guessing what produced an
 * existing verifier.
 */
export const KDF = {
	name: "scrypt" as const,
	N: 2 ** 15,
	r: 8,
	p: 1,
	keylen: 64,
	// scrypt needs 128 * N * r bytes, which is exactly 32 MiB here, and Node's
	// default maxmem is 32 MiB. Without this it throws MEMORY_LIMIT_EXCEEDED, so
	// the app would have failed on the first real unlock. maxmem travels with the
	// record so raising N later cannot invalidate an existing verifier.
	maxmem: 64 * 1024 * 1024,
};

export type KdfParams = typeof KDF;

/** Five wrong tries, then a delay doubling from 30 seconds up to 15 minutes. */
export const FREE_ATTEMPTS = 5;
export const FIRST_PENALTY_MS = 30_000;
export const MAX_PENALTY_MS = 15 * 60_000;

export function newSalt(): string {
	return randomBytes(32).toString("base64");
}

export function deriveVerifier(secret: string, saltB64: string, kdf: KdfParams = KDF): string {
	const salt = Buffer.from(saltB64, "base64");
	return scryptSync(secret, salt, kdf.keylen, {
		N: kdf.N,
		r: kdf.r,
		p: kdf.p,
		maxmem: kdf.maxmem,
	}).toString("base64");
}

/**
 * Constant time. A length check first, because timingSafeEqual throws on a
 * length mismatch rather than returning false, and that throw would itself be an
 * observable difference.
 */
export function verifyAgainst(
	secret: string,
	saltB64: string,
	verifierB64: string,
	kdf: KdfParams = KDF,
): boolean {
	const expected = Buffer.from(verifierB64, "base64");
	const actual = Buffer.from(deriveVerifier(secret, saltB64, kdf), "base64");
	if (expected.length !== actual.length) return false;
	return timingSafeEqual(expected, actual);
}

export interface PenaltyState {
	failedAttempts: number;
	lockedOutUntil: string | null;
}

/**
 * The first five failures cost nothing. After that the wait doubles, so a PIN
 * that would fall to a script in seconds takes days instead.
 */
export function nextPenalty(current: PenaltyState, now = Date.now()): PenaltyState {
	const failedAttempts = current.failedAttempts + 1;
	if (failedAttempts <= FREE_ATTEMPTS) {
		return { failedAttempts, lockedOutUntil: null };
	}
	const over = failedAttempts - FREE_ATTEMPTS - 1;
	const penalty = Math.min(FIRST_PENALTY_MS * 2 ** over, MAX_PENALTY_MS);
	return { failedAttempts, lockedOutUntil: new Date(now + penalty).toISOString() };
}

/** An expired penalty reads as absent, so that reading state never writes. */
export function activePenalty(state: PenaltyState, now = Date.now()): string | null {
	if (!state.lockedOutUntil) return null;
	return Date.parse(state.lockedOutUntil) > now ? state.lockedOutUntil : null;
}

export function remainingAttempts(state: PenaltyState): number {
	return Math.max(0, FREE_ATTEMPTS - state.failedAttempts);
}

export function validateSecret(method: "passphrase" | "pin", secret: string): void {
	if (method === "pin" && !/^\d{4,12}$/.test(secret)) {
		throw new Error("A PIN has to be 4 to 12 digits.");
	}
	if (method === "passphrase" && secret.length < 8) {
		throw new Error("A passphrase has to be at least 8 characters.");
	}
}
