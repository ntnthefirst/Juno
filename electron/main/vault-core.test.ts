import { describe, expect, it } from "vitest";
import {
	FREE_ATTEMPTS,
	MAX_PENALTY_MS,
	activePenalty,
	deriveVerifier,
	newSalt,
	nextPenalty,
	remainingAttempts,
	validateSecret,
	verifyAgainst,
	type PenaltyState,
} from "./vault-core";

// scrypt at N=2^15 is deliberately slow. That is the point of it, but it means
// these tests need more than the default timeout.
const SLOW = { timeout: 20_000 };

describe("verifier", () => {
	it("accepts the right secret and rejects a wrong one", SLOW, () => {
		const salt = newSalt();
		const verifier = deriveVerifier("correct horse battery", salt);

		expect(verifyAgainst("correct horse battery", salt, verifier)).toBe(true);
		expect(verifyAgainst("correct horse batteru", salt, verifier)).toBe(false);
		expect(verifyAgainst("", salt, verifier)).toBe(false);
	});

	it("never stores the secret itself", SLOW, () => {
		const salt = newSalt();
		const secret = "a-very-memorable-passphrase";
		const verifier = deriveVerifier(secret, salt);

		expect(verifier).not.toContain(secret);
		expect(Buffer.from(verifier, "base64").toString("utf8")).not.toContain(secret);
	});

	it("gives a different verifier per salt, so two installs never match", SLOW, () => {
		const a = deriveVerifier("same secret", newSalt());
		const b = deriveVerifier("same secret", newSalt());
		expect(a).not.toEqual(b);
	});

	it("does not throw on a malformed verifier", SLOW, () => {
		expect(verifyAgainst("x", newSalt(), "not-base64-at-all")).toBe(false);
	});
});

describe("penalty", () => {
	const fresh: PenaltyState = { failedAttempts: 0, lockedOutUntil: null };

	it("costs nothing for the first five attempts", () => {
		let state = fresh;
		for (let i = 0; i < FREE_ATTEMPTS; i++) state = nextPenalty(state);
		expect(state.failedAttempts).toBe(FREE_ATTEMPTS);
		expect(state.lockedOutUntil).toBeNull();
		expect(remainingAttempts(state)).toBe(0);
	});

	it("starts at 30 seconds and doubles", () => {
		const now = Date.parse("2026-01-01T00:00:00.000Z");
		let state = fresh;
		for (let i = 0; i < FREE_ATTEMPTS; i++) state = nextPenalty(state, now);

		state = nextPenalty(state, now);
		expect(Date.parse(state.lockedOutUntil!) - now).toBe(30_000);

		state = nextPenalty(state, now);
		expect(Date.parse(state.lockedOutUntil!) - now).toBe(60_000);

		state = nextPenalty(state, now);
		expect(Date.parse(state.lockedOutUntil!) - now).toBe(120_000);
	});

	it("caps the wait rather than growing without bound", () => {
		const now = Date.parse("2026-01-01T00:00:00.000Z");
		let state = fresh;
		for (let i = 0; i < 40; i++) state = nextPenalty(state, now);
		expect(Date.parse(state.lockedOutUntil!) - now).toBe(MAX_PENALTY_MS);
	});

	it("reports an expired penalty as absent, so reading state never writes", () => {
		const past = new Date(Date.now() - 1000).toISOString();
		const future = new Date(Date.now() + 60_000).toISOString();

		expect(activePenalty({ failedAttempts: 9, lockedOutUntil: past })).toBeNull();
		expect(activePenalty({ failedAttempts: 9, lockedOutUntil: future })).toBe(future);
		expect(activePenalty({ failedAttempts: 0, lockedOutUntil: null })).toBeNull();
	});
});

describe("secret rules", () => {
	it("requires a PIN of 4 to 12 digits", () => {
		expect(() => validateSecret("pin", "1234")).not.toThrow();
		expect(() => validateSecret("pin", "123456789012")).not.toThrow();
		expect(() => validateSecret("pin", "123")).toThrow();
		expect(() => validateSecret("pin", "1234567890123")).toThrow();
		expect(() => validateSecret("pin", "12a4")).toThrow();
		expect(() => validateSecret("pin", "")).toThrow();
	});

	it("requires a passphrase of at least 8 characters", () => {
		expect(() => validateSecret("passphrase", "12345678")).not.toThrow();
		expect(() => validateSecret("passphrase", "1234567")).toThrow();
	});
});
