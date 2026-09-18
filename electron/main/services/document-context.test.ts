import { describe, expect, it } from "vitest";
import {
	NBSP,
	formatCents,
	formatDate,
	formatDateTime,
	formatEuros,
	todayIsoDate,
} from "./document-context";

describe("formatDate", () => {
	it("turns an ISO date into the Belgian order", () => {
		expect(formatDate("2026-11-14")).toBe("14/11/2026");
		expect(formatDate("2026-01-02")).toBe("02/01/2026");
	});

	it("returns nothing for nothing", () => {
		expect(formatDate(null)).toBe("");
		expect(formatDate(undefined)).toBe("");
		expect(formatDate("")).toBe("");
	});

	it("leaves an unexpected shape alone rather than mangling it", () => {
		expect(formatDate("14 November")).toBe("14 November");
	});

	it("does not shift the day, which a Date round trip would", () => {
		// A UTC parse of a date-only string lands at midnight UTC, which is the
		// previous day west of Greenwich and the same day here, so a round trip
		// through Date is a bug waiting for a traveller.
		expect(formatDate("2026-03-01")).toBe("01/03/2026");
	});
});

describe("formatCents", () => {
	it("formats whole and part euros", () => {
		expect(formatCents(210000)).toBe(`2${NBSP}100,00`);
		expect(formatCents(125050)).toBe(`1${NBSP}250,50`);
		expect(formatCents(999)).toBe("9,99");
		expect(formatCents(0)).toBe("0,00");
	});

	it("pads a single-digit remainder", () => {
		expect(formatCents(1005)).toBe("10,05");
		expect(formatCents(100)).toBe("1,00");
	});

	it("groups thousands", () => {
		expect(formatCents(100000000)).toBe(`1${NBSP}000${NBSP}000,00`);
	});

	it("handles a negative amount", () => {
		expect(formatCents(-210000)).toBe(`-2${NBSP}100,00`);
	});

	it("returns nothing for nothing, which is not the same as zero", () => {
		expect(formatCents(null)).toBe("");
		expect(formatCents(undefined)).toBe("");
		expect(formatCents(0)).toBe("0,00");
	});

	it("never produces a floating point artefact", () => {
		// 1049.99 as a float times 100 is 104998.99999999999. Integer cents in,
		// integer arithmetic throughout, so this cannot happen.
		expect(formatCents(104999)).toBe(`1${NBSP}049,99`);
		expect(formatCents(1)).toBe("0,01");
	});
});

describe("formatEuros", () => {
	it("prefixes the symbol with a non-breaking space", () => {
		expect(formatEuros(210000)).toBe(`€${NBSP}2${NBSP}100,00`);
	});

	it("stays empty rather than printing a lonely symbol", () => {
		expect(formatEuros(null)).toBe("");
	});
});

describe("todayIsoDate", () => {
	it("uses the local calendar date, not the UTC one", () => {
		// 00:30 local on the 5th. toISOString() would say the 4th anywhere east of
		// Greenwich, which would date a contract a day early.
		const localEarlyMorning = new Date(2026, 4, 5, 0, 30, 0);
		expect(todayIsoDate(localEarlyMorning)).toBe("2026-05-05");
	});

	it("pads month and day", () => {
		expect(todayIsoDate(new Date(2026, 0, 9, 12, 0, 0))).toBe("2026-01-09");
	});
});

describe("formatDateTime", () => {
	it("reads as a date and a time, not as a storage format", () => {
		const local = new Date(2026, 8, 18, 12, 5).toISOString();
		expect(formatDateTime(local)).toBe("18/09/2026 om 12:05");
	});

	it("pads every part", () => {
		const local = new Date(2026, 0, 2, 9, 7).toISOString();
		expect(formatDateTime(local)).toBe("02/01/2026 om 09:07");
	});

	it("returns the input rather than Invalid Date when it cannot parse", () => {
		expect(formatDateTime("not a date")).toBe("not a date");
	});
});
