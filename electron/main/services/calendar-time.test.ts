import { describe, expect, it } from "vitest";
import {
	addLocalDays,
	addLocalMinutes,
	isLocalDate,
	isLocalDateTime,
	isValidTimeZone,
	localDateStartUtc,
	localMinutesBetween,
	localToUtc,
	offsetMinutesAt,
	utcToLocal,
} from "./calendar-time";

const BRU = "Europe/Brussels";

describe("localToUtc", () => {
	it("applies the winter and summer offsets", () => {
		expect(localToUtc("2026-01-15T10:00:00", BRU)).toBe("2026-01-15T09:00:00.000Z");
		expect(localToUtc("2026-07-15T10:00:00", BRU)).toBe("2026-07-15T08:00:00.000Z");
	});

	it("takes the earlier instant when the clocks go back", () => {
		// 25 October 2026: 03:00 CEST becomes 02:00 CET, so 02:30 happens twice.
		expect(localToUtc("2026-10-25T02:30:00", BRU)).toBe("2026-10-25T00:30:00.000Z");
		expect(localToUtc("2026-10-25T03:30:00", BRU)).toBe("2026-10-25T02:30:00.000Z");
	});

	it("pushes a reading in the spring gap forward", () => {
		// 29 March 2026: 02:00 CET becomes 03:00 CEST, so 02:30 never happens.
		expect(localToUtc("2026-03-29T02:30:00", BRU)).toBe("2026-03-29T01:30:00.000Z");
		expect(utcToLocal("2026-03-29T01:30:00.000Z", BRU)).toBe("2026-03-29T03:30:00");
	});

	it("round trips through the other zones people actually use", () => {
		for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "Australia/Sydney", "Pacific/Auckland"]) {
			for (const local of ["2026-01-10T09:15:00", "2026-06-10T23:45:00", "2026-11-01T00:00:00"]) {
				expect(utcToLocal(localToUtc(local, zone), zone)).toBe(local);
			}
		}
	});

	it("handles a zone with a half-hour offset", () => {
		expect(localToUtc("2026-05-01T12:00:00", "Asia/Kolkata")).toBe("2026-05-01T06:30:00.000Z");
		expect(offsetMinutesAt(new Date("2026-05-01T06:30:00Z"), "Asia/Kolkata")).toBe(330);
	});
});

describe("localDateStartUtc", () => {
	it("is the zone's midnight, not UTC midnight", () => {
		expect(localDateStartUtc("2026-07-15", BRU)).toBe("2026-07-14T22:00:00.000Z");
		expect(localDateStartUtc("2026-01-15", BRU)).toBe("2026-01-14T23:00:00.000Z");
	});
});

describe("wall-clock arithmetic", () => {
	it("adds minutes without a zone getting in the way", () => {
		expect(addLocalMinutes("2026-10-25T01:30:00", 120)).toBe("2026-10-25T03:30:00");
		expect(localMinutesBetween("2026-10-25T01:30:00", "2026-10-25T03:30:00")).toBe(120);
	});

	it("keeps a date a date", () => {
		expect(addLocalDays("2026-02-28", 1)).toBe("2026-03-01");
		expect(addLocalDays("2026-03-28T10:00:00", 1)).toBe("2026-03-29T10:00:00");
	});
});

describe("validation", () => {
	it("knows a zone from a typo", () => {
		expect(isValidTimeZone(BRU)).toBe(true);
		expect(isValidTimeZone("Europe/Brussel")).toBe(false);
		expect(isValidTimeZone("")).toBe(false);
	});

	it("tells a date from a date-time and rejects impossible ones", () => {
		expect(isLocalDate("2026-02-28")).toBe(true);
		expect(isLocalDate("2026-02-30")).toBe(false);
		expect(isLocalDate("2026-02-28T10:00:00")).toBe(false);
		expect(isLocalDateTime("2026-02-28T10:00:00")).toBe(true);
		expect(isLocalDateTime("2026-02-28T10:00")).toBe(true);
		expect(isLocalDateTime("2026-02-28")).toBe(false);
	});
});
