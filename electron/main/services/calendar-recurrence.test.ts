import { describe, expect, it } from "vitest";
import {
	describeRule,
	expandSeries,
	isOccurrenceOf,
	normaliseRule,
	occurrencesBefore,
	retargetRule,
	ruleContinuingFrom,
	ruleEndingBefore,
	ruleUntilFromUtc,
	ruleUntilToUtc,
	seriesEndUtc,
	type SeriesShape,
} from "./calendar-recurrence";

const BRU = "Europe/Brussels";

/** A Tuesday call at 10:00 Brussels time, weekly, from late September. */
const tuesdayCall: SeriesShape = {
	startLocal: "2026-09-22T10:00:00",
	endLocal: "2026-09-22T10:30:00",
	allDay: false,
	timezone: BRU,
	rrule: "FREQ=WEEKLY;BYDAY=TU",
};

describe("expandSeries", () => {
	it("keeps the wall clock across the October DST change", () => {
		// The clocks go back on 25 October 2026. The call stays at 10:00 local,
		// which means 08:00Z before and 09:00Z after. Expanding in UTC would put
		// every later occurrence at 08:00Z, an hour early. This is the test the
		// wall-clock storage exists to pass.
		const out = expandSeries(tuesdayCall, [], "2026-10-19T00:00:00.000Z", "2026-11-05T00:00:00.000Z");
		expect(out.map((o) => [o.startLocal, o.startUtc])).toEqual([
			["2026-10-20T10:00:00", "2026-10-20T08:00:00.000Z"],
			["2026-10-27T10:00:00", "2026-10-27T09:00:00.000Z"],
			["2026-11-03T10:00:00", "2026-11-03T09:00:00.000Z"],
		]);
		expect(out[1]!.endUtc).toBe("2026-10-27T09:30:00.000Z");
	});

	it("includes the event's own start even when the rule would skip it", () => {
		const monday: SeriesShape = { ...tuesdayCall, startLocal: "2026-09-21T10:00:00", endLocal: "2026-09-21T10:30:00" };
		const out = expandSeries(monday, [], "2026-09-20T00:00:00.000Z", "2026-09-24T00:00:00.000Z");
		expect(out.map((o) => o.startLocal)).toEqual(["2026-09-21T10:00:00", "2026-09-22T10:00:00"]);
	});

	it("drops a cancelled occurrence and moves a moved one", () => {
		const out = expandSeries(
			tuesdayCall,
			[
				{
					occurrenceStartLocal: "2026-09-29T10:00:00",
					cancelled: true,
					title: null,
					notes: null,
					location: null,
					startLocal: null,
					endLocal: null,
				},
				{
					occurrenceStartLocal: "2026-10-06T10:00:00",
					cancelled: false,
					title: "Moved call",
					notes: null,
					location: null,
					startLocal: "2026-10-08T14:00:00",
					endLocal: null,
				},
			],
			"2026-09-28T00:00:00.000Z",
			"2026-10-12T00:00:00.000Z",
		);
		expect(out.map((o) => [o.startLocal, o.isException, o.title])).toEqual([
			["2026-10-08T14:00:00", true, "Moved call"],
			// The 29th is gone, the 6th moved to the 8th, and the 13th is outside.
		]);
		// A moved occurrence keeps the master's length unless the exception sets one.
		expect(out[0]!.endLocal).toBe("2026-10-08T14:30:00");
	});

	it("finds an occurrence moved from outside the window into it", () => {
		const out = expandSeries(
			tuesdayCall,
			[
				{
					occurrenceStartLocal: "2026-12-01T10:00:00",
					cancelled: false,
					title: null,
					notes: null,
					location: null,
					startLocal: "2026-10-01T09:00:00",
					endLocal: "2026-10-01T09:45:00",
				},
			],
			"2026-09-30T00:00:00.000Z",
			"2026-10-02T00:00:00.000Z",
		);
		expect(out).toHaveLength(1);
		expect(out[0]!.occurrenceStartLocal).toBe("2026-12-01T10:00:00");
		expect(out[0]!.endUtc).toBe("2026-10-01T07:45:00.000Z");
	});

	it("expands an all-day series on dates, not instants", () => {
		const shape: SeriesShape = {
			startLocal: "2026-10-23",
			endLocal: "2026-10-24",
			allDay: true,
			timezone: BRU,
			rrule: "FREQ=DAILY;COUNT=4",
		};
		const out = expandSeries(shape, [], "2026-10-22T00:00:00.000Z", "2026-10-30T00:00:00.000Z");
		expect(out.map((o) => [o.startLocal, o.endLocal])).toEqual([
			["2026-10-23", "2026-10-24"],
			["2026-10-24", "2026-10-25"],
			["2026-10-25", "2026-10-26"],
			["2026-10-26", "2026-10-27"],
		]);
		// The all-day date spans the zone's day, which moves with DST.
		expect(out[1]!.startUtc).toBe("2026-10-23T22:00:00.000Z");
		expect(out[3]!.startUtc).toBe("2026-10-25T23:00:00.000Z");
	});

	it("includes an occurrence that started before the window and overlaps it", () => {
		const long: SeriesShape = {
			startLocal: "2026-09-22T22:00:00",
			endLocal: "2026-09-23T02:00:00",
			allDay: false,
			timezone: BRU,
			rrule: "FREQ=WEEKLY",
		};
		const out = expandSeries(long, [], "2026-09-22T22:30:00.000Z", "2026-09-23T06:00:00.000Z");
		expect(out.map((o) => o.startLocal)).toEqual(["2026-09-22T22:00:00"]);
	});

	it("handles a monthly rule on the last weekday", () => {
		const shape: SeriesShape = {
			startLocal: "2026-01-30T09:00:00",
			endLocal: "2026-01-30T10:00:00",
			allDay: false,
			timezone: BRU,
			rrule: "FREQ=MONTHLY;BYDAY=-1FR",
		};
		const out = expandSeries(shape, [], "2026-02-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
		expect(out.map((o) => o.startLocal)).toEqual(["2026-02-27T09:00:00", "2026-03-27T09:00:00"]);
	});
});

describe("series end", () => {
	it("is the last occurrence's end for COUNT and UNTIL, and null when open", () => {
		expect(seriesEndUtc({ ...tuesdayCall, rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=3" })).toBe(
			"2026-10-06T08:30:00.000Z",
		);
		expect(seriesEndUtc({ ...tuesdayCall, rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261031T000000Z" })).toBe(
			"2026-10-30T23:30:00.000Z",
		);
		expect(seriesEndUtc(tuesdayCall)).toBeNull();
		expect(seriesEndUtc({ ...tuesdayCall, rrule: null })).toBe("2026-09-22T08:30:00.000Z");
	});
});

describe("splitting a series", () => {
	it("ends the first half just before the split and counts the second half down", () => {
		expect(ruleEndingBefore("FREQ=WEEKLY;BYDAY=TU;COUNT=10", "2026-10-13T10:00:00")).toBe(
			"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261013T095959Z",
		);
		expect(occurrencesBefore(tuesdayCall, "2026-10-13T10:00:00")).toBe(3);
		expect(ruleContinuingFrom("FREQ=WEEKLY;BYDAY=TU;COUNT=10", 3)).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=7");
		expect(ruleContinuingFrom("FREQ=WEEKLY;BYDAY=TU", 3)).toBe("FREQ=WEEKLY;BYDAY=TU");
	});

	it("knows which keys the rule produces", () => {
		expect(isOccurrenceOf(tuesdayCall, "2026-10-13T10:00:00")).toBe(true);
		expect(isOccurrenceOf(tuesdayCall, "2026-10-14T10:00:00")).toBe(false);
		expect(isOccurrenceOf(tuesdayCall, "2026-09-22T10:00:00")).toBe(true);
	});
});

describe("rules as text", () => {
	it("normalises and describes", () => {
		expect(normaliseRule("RRULE:freq=weekly;byday=TU")).toBe("FREQ=WEEKLY;BYDAY=TU");
		expect(describeRule("FREQ=WEEKLY;BYDAY=TU")).toBe("Every week on Tuesday");
		expect(describeRule("FREQ=MONTHLY;INTERVAL=2")).toBe("Every 2 months");
		expect(describeRule(null)).toBe("Does not repeat");
	});

	it("refuses what it cannot expand", () => {
		expect(() => normaliseRule("FREQ=HOURLY")).toThrow(/daily, weekly, monthly or yearly/);
		expect(() => normaliseRule("BYDAY=TU")).toThrow(/FREQ/);
		expect(() => normaliseRule("FREQ=WEEKLY;COUNT=0")).toThrow(/COUNT/);
	});

	it("moves UNTIL between wall clock and UTC at the file boundary", () => {
		// Stored: until 23:59:59 local on 31 October. In the file: 22:59:59Z.
		expect(ruleUntilToUtc("FREQ=DAILY;UNTIL=20261031T235959Z", BRU)).toBe("FREQ=DAILY;UNTIL=20261031T225959Z");
		expect(ruleUntilFromUtc("FREQ=DAILY;UNTIL=20261031T225959Z", BRU)).toBe("FREQ=DAILY;UNTIL=20261031T235959Z");
	});
});

describe("retargetRule", () => {
	it("follows the start to its new weekday or month day, and only then", () => {
		expect(retargetRule("FREQ=WEEKLY;BYDAY=TU", "2026-10-13T10:00:00", "2026-10-14T16:00:00")).toBe("FREQ=WEEKLY;BYDAY=WE");
		expect(retargetRule("FREQ=WEEKLY;BYDAY=TU", "2026-10-13T10:00:00", "2026-10-13T16:00:00")).toBe("FREQ=WEEKLY;BYDAY=TU");
		expect(retargetRule("FREQ=WEEKLY;BYDAY=TU,TH", "2026-10-13T10:00:00", "2026-10-14T10:00:00")).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
		expect(retargetRule("FREQ=MONTHLY;BYMONTHDAY=13", "2026-10-13T10:00:00", "2026-10-14T10:00:00")).toBe("FREQ=MONTHLY;BYMONTHDAY=14");
		expect(retargetRule("FREQ=MONTHLY;BYDAY=2TU", "2026-10-13T10:00:00", "2026-10-14T10:00:00")).toBe("FREQ=MONTHLY;BYDAY=+2TU");
	});
});
