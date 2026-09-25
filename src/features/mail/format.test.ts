import { describe, expect, it } from "vitest";
import { formatSyncWhen } from "./format";

/**
 * Built from local components on purpose: the function answers "how many days
 * ago" in the reader's own timezone, so a test that hard-codes UTC would pass
 * or fail depending on where it runs.
 */
function local(year: number, month: number, day: number, hour = 12, minute = 0): string {
	return new Date(year, month - 1, day, hour, minute).toISOString();
}

describe("formatSyncWhen", () => {
	const now = new Date(2026, 8, 24, 20, 30);

	it("gives the clock for today", () => {
		expect(formatSyncWhen(local(2026, 9, 24, 9, 5), now)).toBe("09:05");
	});

	it("says yesterday rather than a weekday", () => {
		expect(formatSyncWhen(local(2026, 9, 23), now)).toBe("Yesterday");
	});

	it("gives the weekday inside the week", () => {
		expect(formatSyncWhen(local(2026, 9, 21), now)).toBe("Mon");
	});

	it("gives the date once the weekday stops being useful", () => {
		expect(formatSyncWhen(local(2026, 9, 1), now)).toBe("1 Sept");
	});

	it("carries the year for anything older", () => {
		expect(formatSyncWhen(local(2025, 12, 30), now)).toBe("30 Dec 2025");
	});

	/**
	 * Brussels loses an hour on the last Sunday of March, so a plain division by
	 * 24 hours reports 0.96 days and calls the day before "today".
	 */
	it("counts calendar days across a clock change", () => {
		const afterTheChange = new Date(2026, 2, 29, 10, 0);
		expect(formatSyncWhen(local(2026, 3, 28, 23, 30), afterTheChange)).toBe("Yesterday");
	});

	it("says nothing for a value it cannot read", () => {
		expect(formatSyncWhen("not a date", now)).toBe("");
	});
});
