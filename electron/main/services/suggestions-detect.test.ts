import { describe, expect, it } from "vitest";
import { detectMoment, detectReminder, stripQuotedHistory } from "./suggestions-detect";

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

describe("detectReminder", () => {
	const due = (text: string) => detectReminder(text, WRITTEN, WRITTEN);

	it("reads a request by a day in Dutch", () => {
		expect(due("Dag Nathan, kan je de tekeningen tegen vrijdag bezorgen?")).toEqual({
			kind: "deadline",
			dueOn: "2026-11-06",
			dayLabel: "Friday",
		});
		expect(due("Graag voor 15 maart de getekende offerte terug.")).toMatchObject({ dueOn: "2027-03-15" });
		// A year-less day that already went by would roll a year ahead, which a request never means.
		expect(due("Graag voor 2 november de getekende offerte terug.")).toBeNull();
		expect(due("Graag voor 15 november de getekende offerte terug.")).toMatchObject({
			kind: "deadline",
			dueOn: "2026-11-15",
			dayLabel: "15 November",
		});
		expect(due("Stuur het uiterlijk tegen morgen door aub.")).toMatchObject({ dueOn: "2026-11-05", dayLabel: "tomorrow" });
	});

	it("reads a request by a day in English", () => {
		expect(due("Could you send the drawings by Friday?")).toMatchObject({ kind: "deadline", dueOn: "2026-11-06" });
		expect(due("We need your reply before 20 November, please.")).toMatchObject({ dueOn: "2026-11-20" });
		expect(due("The deadline is 12/11/2026.")).toMatchObject({ dueOn: "2026-11-12" });
		expect(due("No later than next Monday.")).toMatchObject({ dueOn: "2026-11-09" });
	});

	it("reads a promise to come back, on the day named or a week on", () => {
		expect(due("Bedankt voor de info. Ik laat iets weten.")).toEqual({
			kind: "followup",
			dueOn: "2026-11-11",
			dayLabel: "11 November",
		});
		expect(due("Ik laat het u dinsdag weten.")).toMatchObject({ kind: "followup", dueOn: "2026-11-10" });
		expect(due("Ik laat volgende week iets van me horen.")).toMatchObject({ kind: "followup", dueOn: "2026-11-11" });
		expect(due("Thanks, I'll get back to you on Thursday.")).toMatchObject({ kind: "followup", dueOn: "2026-11-05" });
		expect(due("We will follow up once the quote is in.")).toMatchObject({ kind: "followup", dueOn: "2026-11-11" });
		expect(due("Ik kom er volgende week op terug.")).toMatchObject({ kind: "followup" });
		expect(due("Ik bel u terug.")).toMatchObject({ kind: "followup" });
	});

	it("prefers the request over the promise when a mail has both", () => {
		expect(due("Ik laat iets weten. Graag tegen vrijdag je cijfers.")?.kind).toBe("deadline");
	});

	it("says nothing for a date with no cue in front of it", () => {
		expect(due("Op 15 november hadden we het over de keuken.")).toBeNull();
		expect(due("De factuur van 12 november staat open.")).toBeNull();
		expect(due("Since Friday nothing has changed.")).toBeNull();
		expect(due("Vrijdag is de leverancier gesloten.")).toBeNull();
	});

	it("says nothing when the number is not a date", () => {
		expect(due("Tegen 15% korting kan ik het doen.")).toBeNull();
		expect(due("Reken op voor 12 personen en een budget voor 10.12 euro.")).toBeNull();
		expect(due("We komen met 3-4 uur voor de montage.")).toBeNull();
		expect(due("Dat kost 15.50 euro voor 6 stuks.")).toBeNull();
		expect(due("By the way, the oak is here.")).toBeNull();
	});

	it("says nothing for a day that has passed, or an appointment with a time", () => {
		expect(due("Dit moest tegen dinsdag klaar zijn.")).toMatchObject({ dueOn: "2026-11-10" });
		expect(detectReminder("Graag voor 2 november 2026.", WRITTEN, WRITTEN)).toBeNull();
		expect(due("Kan je tegen vrijdag om 10:00 langskomen?")).toBeNull();
	});

	it("says nothing for a request to the writer or for quoted history", () => {
		expect(due("Kunt u mij laten weten wat het kost?")).toBeNull();
		expect(due("Please let me know when you are in.")).toBeNull();
		expect(due("Prima.\n> Ik laat iets weten.\n> Tegen vrijdag graag.")).toBeNull();
	});

	it("counts a weekday from the day the message was written, not from today", () => {
		const written = new Date(2026, 10, 2, 9, 0);
		expect(detectReminder("Tegen vrijdag graag.", written, WRITTEN)).toMatchObject({ dueOn: "2026-11-06" });
		expect(detectReminder("Ik laat iets weten.", written, WRITTEN)).toMatchObject({ dueOn: "2026-11-09" });
	});
});
