import { describe, expect, it } from "vitest";
import {
	addDays,
	addMonths,
	daysInMonth,
	describe as describeRecurrence,
	nextOccurrence,
	quarterEnd,
	type Recurrence,
} from "./recurrence";

describe("addDays", () => {
	it("crosses a month", () => {
		expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
	});

	it("crosses a year", () => {
		expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
	});

	it("handles a leap day", () => {
		expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
	});

	it("goes backwards", () => {
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
	});

	it("does not drift across a DST boundary", () => {
		// Brussels springs forward on 29 March 2026. Local-time arithmetic here
		// would produce 2026-03-29 twice, or skip it.
		expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
		expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
		// And back again in October.
		expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
		expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
	});
});

describe("addMonths", () => {
	it("keeps the day when the target month is long enough", () => {
		expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
	});

	it("clamps to the end of a short month rather than spilling over", () => {
		expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
		expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
	});

	it("clamps onto a leap day when there is one", () => {
		expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
	});

	it("returns to the anchor day after a clamp", () => {
		// The point of anchorDay. Advancing from the clamped 28 February would put
		// the series on the 28th forever.
		expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
		expect(addMonths("2026-04-30", 1, 31)).toBe("2026-05-31");
	});

	it("crosses a year", () => {
		expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
	});
});

describe("daysInMonth", () => {
	it("knows the short months and the leap years", () => {
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2028, 2)).toBe(29);
		expect(daysInMonth(2026, 4)).toBe(30);
		expect(daysInMonth(2026, 12)).toBe(31);
		expect(daysInMonth(2100, 2)).toBe(28);
		expect(daysInMonth(2000, 2)).toBe(29);
	});
});

describe("quarterEnd", () => {
	it("finds the end of the quarter the date falls in", () => {
		expect(quarterEnd("2026-01-05")).toBe("2026-03-31");
		expect(quarterEnd("2026-04-30")).toBe("2026-06-30");
		expect(quarterEnd("2026-08-01")).toBe("2026-09-30");
		expect(quarterEnd("2026-11-20")).toBe("2026-12-31");
	});

	it("is stable on a quarter end", () => {
		expect(quarterEnd("2026-03-31")).toBe("2026-03-31");
	});
});

describe("nextOccurrence", () => {
	const once: Recurrence = { pattern: "once", interval: 1 };

	it("returns null for a one-off, so completing it finishes it", () => {
		expect(nextOccurrence("2026-01-01", once)).toBeNull();
	});

	it("steps by days and weeks", () => {
		expect(nextOccurrence("2026-01-01", { pattern: "days", interval: 1 })).toBe("2026-01-02");
		expect(nextOccurrence("2026-01-01", { pattern: "days", interval: 10 })).toBe("2026-01-11");
		expect(nextOccurrence("2026-01-01", { pattern: "weeks", interval: 2 })).toBe("2026-01-15");
	});

	it("steps by months, keeping the anchor", () => {
		expect(nextOccurrence("2026-01-31", { pattern: "months", interval: 1, anchorDay: 31 })).toBe(
			"2026-02-28",
		);
		expect(nextOccurrence("2026-02-28", { pattern: "months", interval: 1, anchorDay: 31 })).toBe(
			"2026-03-31",
		);
	});

	it("steps by years", () => {
		expect(nextOccurrence("2026-06-01", { pattern: "years", interval: 1 })).toBe("2027-06-01");
	});

	it("walks quarter ends", () => {
		expect(nextOccurrence("2026-03-31", { pattern: "quarter_end", interval: 1 })).toBe(
			"2026-06-30",
		);
		expect(nextOccurrence("2026-12-31", { pattern: "quarter_end", interval: 1 })).toBe(
			"2027-03-31",
		);
	});

	it("skips past a date that is already behind, rather than returning it", () => {
		// A weekly reminder untouched for a month should land on the next future
		// occurrence, not on the one that was missed first.
		const next = nextOccurrence("2026-01-01", { pattern: "weeks", interval: 1 }, "2026-02-03");
		expect(next).toBe("2026-02-05");
	});

	it("always moves strictly forward", () => {
		const from = "2026-05-10";
		for (const recurrence of [
			{ pattern: "days", interval: 1 },
			{ pattern: "weeks", interval: 1 },
			{ pattern: "months", interval: 1 },
			{ pattern: "years", interval: 1 },
			{ pattern: "quarter_end", interval: 1 },
		] as Recurrence[]) {
			const next = nextOccurrence("2026-05-10", recurrence, from);
			expect(next).not.toBeNull();
			expect(next! > from).toBe(true);
		}
	});

	it("treats a zero or negative interval as one rather than spinning", () => {
		expect(nextOccurrence("2026-01-01", { pattern: "days", interval: 0 })).toBe("2026-01-02");
		expect(nextOccurrence("2026-01-01", { pattern: "days", interval: -5 })).toBe("2026-01-02");
	});
});

describe("describe", () => {
	it("reads as English, singular and plural", () => {
		expect(describeRecurrence({ pattern: "once", interval: 1 })).toBe("Once");
		expect(describeRecurrence({ pattern: "days", interval: 1 })).toBe("Every day");
		expect(describeRecurrence({ pattern: "days", interval: 3 })).toBe("Every 3 days");
		expect(describeRecurrence({ pattern: "months", interval: 1 })).toBe("Every month");
		expect(describeRecurrence({ pattern: "quarter_end", interval: 1 })).toBe(
			"End of every quarter",
		);
	});
});
