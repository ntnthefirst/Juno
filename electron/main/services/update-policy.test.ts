import { describe, expect, it } from "vitest";
import {
	allowManualCheck,
	CHECK_INTERVAL_MS,
	FIRST_CHECK_DELAY_MS,
	MANUAL_LIMIT,
	MANUAL_WINDOW_MS,
	nextCheckDelay,
} from "./update-policy";

const NOW = Date.parse("2026-03-14T09:00:00.000Z");

describe("nextCheckDelay", () => {
	it("waits the launch delay when nothing has ever been checked", () => {
		expect(nextCheckDelay(null, NOW)).toBe(FIRST_CHECK_DELAY_MS);
	});

	it("waits the launch delay when the stored timestamp is unreadable", () => {
		expect(nextCheckDelay("not a date", NOW)).toBe(FIRST_CHECK_DELAY_MS);
	});

	it("counts from the last check rather than from this launch", () => {
		const last = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
		expect(nextCheckDelay(last, NOW)).toBe(CHECK_INTERVAL_MS - 30 * 60 * 60 * 1000);
	});

	it("checks shortly after launch when one is already overdue", () => {
		const last = new Date(NOW - CHECK_INTERVAL_MS - 1).toISOString();
		expect(nextCheckDelay(last, NOW)).toBe(FIRST_CHECK_DELAY_MS);
	});

	it("never parks the next check further out than one interval", () => {
		// A settings file written by a machine whose clock is a week ahead.
		const last = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
		expect(nextCheckDelay(last, NOW)).toBe(CHECK_INTERVAL_MS);
	});
});

describe("allowManualCheck", () => {
	it("allows the first press and records it", () => {
		const verdict = allowManualCheck([], NOW);
		expect(verdict.allowed).toBe(true);
		expect(verdict.retryAfterMs).toBe(0);
		expect(verdict.recent).toEqual([NOW]);
	});

	it("allows exactly three presses in a minute", () => {
		let recent: number[] = [];
		for (let press = 0; press < MANUAL_LIMIT; press++) {
			const verdict = allowManualCheck(recent, NOW + press * 1000);
			expect(verdict.allowed).toBe(true);
			recent = verdict.recent;
		}
		expect(recent).toHaveLength(MANUAL_LIMIT);

		const fourth = allowManualCheck(recent, NOW + 3000);
		expect(fourth.allowed).toBe(false);
		expect(fourth.recent).toHaveLength(MANUAL_LIMIT);
	});

	it("says how long to wait, counting from the oldest press in the window", () => {
		const recent = [NOW, NOW + 1000, NOW + 2000];
		const verdict = allowManualCheck(recent, NOW + 3000);
		expect(verdict.allowed).toBe(false);
		expect(verdict.retryAfterMs).toBe(MANUAL_WINDOW_MS - 3000);
	});

	it("slides, so the fourth press is allowed once the first has aged out", () => {
		const recent = [NOW, NOW + 1000, NOW + 2000];
		const verdict = allowManualCheck(recent, NOW + MANUAL_WINDOW_MS + 1);
		expect(verdict.allowed).toBe(true);
		// The first press left the window; the other two are still in it.
		expect(verdict.recent).toEqual([NOW + 1000, NOW + 2000, NOW + MANUAL_WINDOW_MS + 1]);
	});

	it("does not refuse forever when the clock moves backwards", () => {
		const recent = [NOW, NOW + 1000, NOW + 2000];
		const verdict = allowManualCheck(recent, NOW - 60 * 60 * 1000);
		expect(verdict.allowed).toBe(true);
	});
});
