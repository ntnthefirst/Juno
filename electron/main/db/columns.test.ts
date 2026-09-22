import { describe, expect, it } from "vitest";
import { uuidv7 } from "./columns";

describe("uuidv7", () => {
	it("is a well-formed version 7 id", () => {
		const id = uuidv7();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	/**
	 * The property the whole schema leans on. Decision 4 picks v7 because it
	 * sorts by time; with randomness straight after the timestamp that is only
	 * true across milliseconds, and every burst write (a seed, a sync, an audit
	 * trail) lands inside one. This is the test that noticed.
	 */
	it("sorts in creation order even inside a single millisecond", () => {
		const ids = Array.from({ length: 5000 }, () => uuidv7());
		const sorted = [...ids].sort();
		expect(ids).toEqual(sorted);
	});

	it("never repeats", () => {
		const ids = Array.from({ length: 5000 }, () => uuidv7());
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("still carries the millisecond, so ids remain time-ordered across them", async () => {
		const before = uuidv7();
		await new Promise((resolve) => setTimeout(resolve, 3));
		const after = uuidv7();
		expect(before < after).toBe(true);
		// The first 48 bits are the timestamp, so a later id has a later prefix.
		expect(before.slice(0, 8) <= after.slice(0, 8)).toBe(true);
	});
});
