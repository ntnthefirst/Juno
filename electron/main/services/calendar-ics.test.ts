import { describe, expect, it } from "vitest";
import { buildIcs, buildVtimezone, parseIcs, type IcsEvent } from "./calendar-ics";
import { expandSeries } from "./calendar-recurrence";

const BRU = "Europe/Brussels";

const tuesdayCall: IcsEvent = {
	icalUid: "call@bureau",
	title: "Weekly call, obet",
	notes: "Agenda:\nlast week; this week",
	location: null,
	allDay: false,
	startLocal: "2026-09-22T10:00:00",
	endLocal: "2026-09-22T10:30:00",
	timezone: BRU,
	rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z",
	exceptions: [
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
			// Moved to the Thursday after the clocks went back.
			occurrenceStartLocal: "2026-10-27T10:00:00",
			cancelled: false,
			title: null,
			notes: null,
			location: "Their office",
			startLocal: "2026-10-29T14:00:00",
			endLocal: null,
		},
	],
	createdAt: "2026-09-01T08:00:00.000Z",
	updatedAt: "2026-09-02T08:00:00.000Z",
};

describe("buildIcs", () => {
	it("writes wall-clock times with the zone, a UTC UNTIL, EXDATE and an override", () => {
		const out = buildIcs([tuesdayCall], "2026-09-21T12:00:00.000Z");
		expect(out).toContain("BEGIN:VCALENDAR\r\n");
		expect(out).toContain("PRODID:-//Bureau//Calendar//EN");
		expect(out).toContain("TZID:Europe/Brussels");
		expect(out).toContain("DTSTART;TZID=Europe/Brussels:20260922T100000");
		expect(out).toContain("DTEND;TZID=Europe/Brussels:20260922T103000");
		expect(out).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T225959Z");
		expect(out).toContain("EXDATE;TZID=Europe/Brussels:20260929T100000");
		expect(out).toContain("RECURRENCE-ID;TZID=Europe/Brussels:20261027T100000");
		expect(out).toContain("DTSTART;TZID=Europe/Brussels:20261029T140000");
		expect(out).toContain("DTEND;TZID=Europe/Brussels:20261029T143000");
		expect(out).toContain("LOCATION:Their office");
		expect(out).toContain("DESCRIPTION:Agenda:\\nlast week\\; this week");
		expect(out).toContain("SUMMARY:Weekly call\\, obet");
		expect(out).toContain("DTSTAMP:20260902T080000Z");
		expect(out).toContain("CREATED:20260901T080000Z");
	});

	it("describes the Brussels zone with the EU rule", () => {
		const tz = buildVtimezone(BRU, 2026).toString();
		expect(tz).toContain("BEGIN:DAYLIGHT\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nDTSTART:20260329T020000");
		expect(tz).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
		expect(tz).toContain("BEGIN:STANDARD\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nDTSTART:20261025T030000");
		expect(tz).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
	});

	it("gives a zone without DST one block and a half-hour zone its offset", () => {
		expect(buildVtimezone("Asia/Kolkata", 2026).toString()).toContain("TZOFFSETTO:+0530");
		expect(buildVtimezone("Asia/Kolkata", 2026).toString()).not.toContain("DAYLIGHT");
		expect(buildVtimezone("America/New_York", 2026).toString()).toContain("BYMONTH=3;BYDAY=2SU");
	});

	it("writes an all-day series with dates only", () => {
		const out = buildIcs(
			[
				{
					...tuesdayCall,
					allDay: true,
					startLocal: "2026-10-23",
					endLocal: "2026-10-24",
					rrule: "FREQ=DAILY;UNTIL=20261031T000000Z",
					exceptions: [],
				},
			],
			"2026-09-21T12:00:00.000Z",
		);
		expect(out).toContain("DTSTART;VALUE=DATE:20261023");
		expect(out).toContain("DTEND;VALUE=DATE:20261024");
		expect(out).toContain("RRULE:FREQ=DAILY;UNTIL=20261031");
		expect(out).not.toContain("VTIMEZONE");
	});
});

describe("round trip", () => {
	it("comes back as the same event, with the moved occurrence on the right hour", () => {
		const out = buildIcs([tuesdayCall], "2026-09-21T12:00:00.000Z");
		const { events, warnings } = parseIcs(out, "UTC");
		expect(warnings).toEqual([]);
		expect(events).toHaveLength(1);
		const back = events[0]!;
		expect(back.icalUid).toBe("call@bureau");
		expect(back.title).toBe("Weekly call, obet");
		expect(back.notes).toBe("Agenda:\nlast week; this week");
		expect(back.timezone).toBe(BRU);
		expect(back.startLocal).toBe("2026-09-22T10:00:00");
		expect(back.endLocal).toBe("2026-09-22T10:30:00");
		expect(back.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z");
		expect(back.exceptions).toHaveLength(2);
		expect(back.exceptions.find((e) => e.cancelled)?.occurrenceStartLocal).toBe("2026-09-29T10:00:00");
		const moved = back.exceptions.find((e) => !e.cancelled)!;
		expect(moved.occurrenceStartLocal).toBe("2026-10-27T10:00:00");
		expect(moved.startLocal).toBe("2026-10-29T14:00:00");
		expect(moved.endLocal).toBe("2026-10-29T14:30:00");
		expect(moved.location).toBe("Their office");
		expect(moved.title).toBeNull();

		// The done-when test from PLAN.md phase 5: after the October change, the
		// moved occurrence is at 14:00 Brussels, which is 13:00Z, and the regular
		// ones are still at 10:00 Brussels, now 09:00Z.
		const occurrences = expandSeries(back, back.exceptions, "2026-10-26T00:00:00.000Z", "2026-11-04T00:00:00.000Z");
		expect(occurrences.map((o) => [o.startLocal, o.startUtc])).toEqual([
			["2026-10-29T14:00:00", "2026-10-29T13:00:00.000Z"],
			["2026-11-03T10:00:00", "2026-11-03T09:00:00.000Z"],
		]);
	});
});

describe("parseIcs", () => {
	const lines = (...items: string[]) => items.join("\r\n");

	it("reads an Outlook-style zone through its VTIMEZONE and says so", () => {
		const source = lines(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
			"BEGIN:VTIMEZONE",
			"TZID:Romance Standard Time",
			"BEGIN:STANDARD",
			"DTSTART:16011028T030000",
			"RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
			"TZOFFSETFROM:+0200",
			"TZOFFSETTO:+0100",
			"END:STANDARD",
			"BEGIN:DAYLIGHT",
			"DTSTART:16010325T020000",
			"RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
			"TZOFFSETFROM:+0100",
			"TZOFFSETTO:+0200",
			"END:DAYLIGHT",
			"END:VTIMEZONE",
			"BEGIN:VEVENT",
			"UID:outlook@x",
			"DTSTART;TZID=Romance Standard Time:20261027T100000",
			"DTEND;TZID=Romance Standard Time:20261027T110000",
			"SUMMARY:Outlook style",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const { events, warnings } = parseIcs(source, BRU);
		expect(events).toHaveLength(1);
		expect(events[0]!.timezone).toBe(BRU);
		expect(events[0]!.startLocal).toBe("2026-10-27T10:00:00");
		expect(events[0]!.endLocal).toBe("2026-10-27T11:00:00");
		expect(warnings[0]).toMatch(/Romance Standard Time/);
	});

	it("expresses a UTC event in the default zone, and takes a duration", () => {
		const source = lines(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:utc@x",
			"DTSTART:20261027T090000Z",
			"DURATION:PT45M",
			"SUMMARY:UTC style",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const { events } = parseIcs(source, BRU);
		expect(events[0]!.startLocal).toBe("2026-10-27T10:00:00");
		expect(events[0]!.endLocal).toBe("2026-10-27T10:45:00");
		expect(events[0]!.timezone).toBe(BRU);
	});

	it("keeps an all-day event as dates and defaults a missing end to one day", () => {
		const source = lines(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:day@x",
			"DTSTART;VALUE=DATE:20261101",
			"SUMMARY:Holiday",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const { events } = parseIcs(source, BRU);
		expect(events[0]!.allDay).toBe(true);
		expect(events[0]!.startLocal).toBe("2026-11-01");
		expect(events[0]!.endLocal).toBe("2026-11-02");
	});

	it("attaches an override to its series when the zones differ", () => {
		// The override is written in UTC by a tool that did not keep the zone.
		const source = lines(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:s@x",
			"DTSTART;TZID=Europe/Brussels:20260922T100000",
			"DTEND;TZID=Europe/Brussels:20260922T103000",
			"RRULE:FREQ=WEEKLY;BYDAY=TU",
			"SUMMARY:Series",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"UID:s@x",
			"RECURRENCE-ID:20261027T090000Z",
			"DTSTART:20261029T130000Z",
			"DTEND:20261029T133000Z",
			"SUMMARY:Series",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const { events } = parseIcs(source, "UTC");
		expect(events).toHaveLength(1);
		expect(events[0]!.exceptions).toEqual([
			{
				occurrenceStartLocal: "2026-10-27T10:00:00",
				cancelled: false,
				title: null,
				notes: null,
				location: null,
				startLocal: "2026-10-29T14:00:00",
				endLocal: "2026-10-29T14:30:00",
			},
		]);
	});

	it("refuses something that is not a calendar", () => {
		expect(() => parseIcs("hello", BRU)).toThrow(/not a calendar/);
		expect(() => parseIcs("BEGIN:VCARD\r\nEND:VCARD", BRU)).toThrow(/no VCALENDAR/);
	});
});
