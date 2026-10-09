import { describe, expect, it } from "vitest";
import { bucketOf, groupByDay } from "./day-groups";

// Built from local parts, so the day a moment falls on does not depend on the
// zone the test machine is in.
const NOW = new Date(2026, 9, 3, 14, 30);

function daysAgo(days: number, hour = 9): string {
	return new Date(2026, 9, 3 - days, hour).toISOString();
}

describe("bucketOf", () => {
	it("calls the early hours of today today, not yesterday", () => {
		expect(bucketOf(new Date(2026, 9, 3, 0, 5), NOW).label).toBe("Today");
	});

	it("calls the last minute of yesterday yesterday", () => {
		expect(bucketOf(new Date(2026, 9, 2, 23, 59), NOW).label).toBe("Yesterday");
	});

	it("counts whole calendar days, so 23 hours ago can be yesterday", () => {
		expect(bucketOf(new Date(2026, 9, 2, 15, 30), NOW).label).toBe("Yesterday");
	});

	it("puts two to six days back in the last 7 days", () => {
		expect(bucketOf(new Date(2026, 9, 1, 9), NOW).label).toBe("Last 7 days");
		expect(bucketOf(new Date(2026, 8, 27, 9), NOW).label).toBe("Last 7 days");
	});

	it("puts a week to a month back in the last 30 days", () => {
		expect(bucketOf(new Date(2026, 8, 26, 9), NOW).label).toBe("Last 30 days");
		expect(bucketOf(new Date(2026, 8, 5, 9), NOW).label).toBe("Last 30 days");
	});

	it("names an older month, and the year only when it is not this one", () => {
		expect(bucketOf(new Date(2026, 5, 12), NOW).label).toBe("June");
		expect(bucketOf(new Date(2025, 11, 12), NOW).label).toBe("December 2025");
	});

	it("treats something later today, or in the future, as today", () => {
		expect(bucketOf(new Date(2026, 9, 3, 23, 0), NOW).label).toBe("Today");
		expect(bucketOf(new Date(2026, 9, 9, 9), NOW).label).toBe("Today");
	});
});

describe("groupByDay", () => {
	it("keeps newest-first order across and inside the groups", () => {
		const rows = [
			{ id: "a", at: daysAgo(0, 13) },
			{ id: "b", at: daysAgo(0, 8) },
			{ id: "c", at: daysAgo(1) },
			{ id: "d", at: daysAgo(3) },
			{ id: "e", at: daysAgo(40) },
		];
		const groups = groupByDay(rows, (row) => row.at, NOW);
		expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Last 7 days", "August"]);
		expect(groups[0]?.items.map((row) => row.id)).toEqual(["a", "b"]);
	});

	it("leaves out a group nothing falls in", () => {
		const groups = groupByDay([{ at: daysAgo(0) }, { at: daysAgo(10) }], (row) => row.at, NOW);
		expect(groups.map((group) => group.label)).toEqual(["Today", "Last 30 days"]);
	});

	it("keeps a row whose date cannot be read, under Earlier", () => {
		const groups = groupByDay([{ at: "not a date" }], (row) => row.at, NOW);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.label).toBe("Earlier");
		expect(groups[0]?.items).toHaveLength(1);
	});

	it("returns nothing for nothing", () => {
		expect(groupByDay([], () => "", NOW)).toEqual([]);
	});
});
