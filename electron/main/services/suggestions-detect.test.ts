import { describe, expect, it } from "vitest";
import { detectMoment, stripQuotedHistory } from "./suggestions-detect";

// Wednesday 4 November 2026, 09:00 in the machine's own zone.
const WRITTEN = new Date(2026, 10, 4, 9, 0);

describe("detectMoment", () => {
	it("reads a weekday and a time in Dutch", () => {
		const found = detectMoment("Dag Nathan, kunnen we vrijdag om 10:00 leveren?", WRITTEN, WRITTEN);
		expect(found).toEqual({ startLocal: "2026-11-06T10:00:00", dayLabel: "Friday", time: "10:00" });
	});

	it("reads the same in English, with am and pm", () => {
		expect(detectMoment("Delivery is on Friday at 10am.", WRITTEN, WRITTEN)?.startLocal).toBe("2026-11-06T10:00:00");
		expect(detectMoment("See you tomorrow at 3:30 pm", WRITTEN, WRITTEN)?.startLocal).toBe("2026-11-05T15:30:00");
	});

	it("reads relative days and the Dutch ways of writing a time", () => {
		expect(detectMoment("Morgen om 14u30 ben ik er.", WRITTEN, WRITTEN)?.startLocal).toBe("2026-11-05T14:30:00");
		expect(detectMoment("Overmorgen rond 9 uur.", WRITTEN, WRITTEN)?.startLocal).toBe("2026-11-06T09:00:00");
	});

	it("reads a written date, with or without a year", () => {
		expect(detectMoment("De afspraak is op 12 november om 11:00.", WRITTEN, WRITTEN)).toMatchObject({
			startLocal: "2026-11-12T11:00:00",
			dayLabel: "12 November",
		});
		expect(detectMoment("Meeting 14/12/2026 at 16:00", WRITTEN, WRITTEN)?.startLocal).toBe("2026-12-14T16:00:00");
	});

	it("counts a weekday from the day it was written, never the same day", () => {
		const onWednesday = detectMoment("Wednesday at 10:00 then.", WRITTEN, WRITTEN);
		expect(onWednesday?.startLocal).toBe("2026-11-11T10:00:00");
	});

	it("rolls a date without a year that has passed into next year", () => {
		expect(detectMoment("Op 2 maart om 10:00.", WRITTEN, WRITTEN)?.startLocal).toBe("2027-03-02T10:00:00");
	});

	it("needs both a day and a time in one sentence", () => {
		expect(detectMoment("Vrijdag komt goed uit.", WRITTEN, WRITTEN)).toBeNull();
		expect(detectMoment("Bel me om 10:00. Vrijdag niet.", WRITTEN, WRITTEN)).toBeNull();
		expect(detectMoment("Het kost 12.50 euro.", WRITTEN, WRITTEN)).toBeNull();
	});

	it("refuses a moment that has passed, an impossible date and an impossible time", () => {
		const later = new Date(2026, 10, 7, 12, 0);
		expect(detectMoment("Vrijdag om 10:00.", WRITTEN, later)).toBeNull();
		expect(detectMoment("Op 31 februari om 10:00.", WRITTEN, WRITTEN)).toBeNull();
		expect(detectMoment("Vrijdag om 25:00.", WRITTEN, WRITTEN)).toBeNull();
	});

	it("ignores quoted history", () => {
		const text = "Ok, bedankt.\n\nOn Tue, 3 Nov 2026, Jan wrote:\n> Vrijdag om 10:00?";
		expect(detectMoment(text, WRITTEN, WRITTEN)).toBeNull();
		expect(stripQuotedHistory(text)).not.toContain("Vrijdag");
		expect(detectMoment("Prima.\n> Vrijdag om 10:00", WRITTEN, WRITTEN)).toBeNull();
	});
});
