import { describe, expect, it } from "vitest";
import { cleanText, feedName, MAX_EVENTS, nextOccurrence, normaliseAddress, parseFeed } from "./calendar-feed";

const BRU = "Europe/Brussels";

function calendar(...lines: string[]): string {
	return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...lines, "END:VCALENDAR"].join("\r\n");
}

function vevent(uid: string, ...lines: string[]): string {
	return ["BEGIN:VEVENT", `UID:${uid}`, ...lines, "END:VEVENT"].join("\r\n");
}

describe("normaliseAddress", () => {
	it("keeps https, reads webcal as https, drops the fragment and refuses the rest", () => {
		expect(normaliseAddress(" https://example.com/a.ics#x ").href).toBe("https://example.com/a.ics");
		expect(normaliseAddress("webcal://example.com/a.ics").href).toBe("https://example.com/a.ics");
		expect(() => normaliseAddress("http://example.com/a.ics")).toThrow(/https/);
		expect(() => normaliseAddress("ftp://example.com/a.ics")).toThrow(/https/);
		expect(() => normaliseAddress("https://me:pw@example.com/a.ics")).toThrow(/login/);
		expect(() => normaliseAddress("")).toThrow(/Paste/);
		expect(() => normaliseAddress(`https://example.com/${"a".repeat(3000)}`)).toThrow(/too long/);
	});
});

describe("reading a feed as hostile input", () => {
	it("strips control characters and cuts long text", () => {
		expect(cleanText("Shift\u0007 one\u200b\u202a", 50)).toBe("Shift one");
		expect(cleanText("x".repeat(400), 300)).toHaveLength(300);
	});

	it("reads the calendar's own name, unfolded and cleaned", () => {
		expect(feedName(calendar("X-WR-CALNAME:Belgian\r\n  public holidays"))).toBe("Belgian public holidays");
		expect(feedName(calendar())).toBeNull();
	});

	it("refuses what is not a calendar, and a feed with too many events", () => {
		expect(() => parseFeed("<html></html>", "example.com", BRU)).toThrow(/example\.com did not send a calendar/);
		const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) =>
			vevent(`e${i}`, "SUMMARY:x", "DTSTART;VALUE=DATE:20261101"),
		);
		expect(() => parseFeed(calendar(...many), "example.com", BRU)).toThrow(/at most 10,000/);
	});

	it("cuts a runaway COUNT and drops a rule that repeats by the hour", () => {
		const parsed = parseFeed(
			calendar(
				vevent("count", "SUMMARY:Forever", "DTSTART;TZID=Europe/Brussels:20261102T100000", "DTEND;TZID=Europe/Brussels:20261102T110000", "RRULE:FREQ=DAILY;COUNT=99999999"),
				vevent("hourly", "SUMMARY:Ping", "DTSTART;TZID=Europe/Brussels:20261102T100000", "RRULE:FREQ=HOURLY"),
			),
			"example.com",
			BRU,
		);
		const count = parsed.events.find((e) => e.icalUid === "count")!;
		expect(count.rrule).toContain("COUNT=2000");
		expect(count.seriesEndUtc).not.toBeNull();
		expect(parsed.events.find((e) => e.icalUid === "hourly")!.rrule).toBeNull();
	});

	it("keeps a title of a sane length and no markup is evaluated", () => {
		const parsed = parseFeed(
			calendar(vevent("long", `SUMMARY:<script>alert(1)</script>${"y".repeat(1000)}`, "DTSTART;VALUE=DATE:20261101")),
			"example.com",
			BRU,
		);
		expect(parsed.events[0]!.title.length).toBeLessThanOrEqual(300);
		expect(parsed.events[0]!.title.startsWith("<script>")).toBe(true);
	});
});

describe("nextOccurrence", () => {
	it("finds the next start from now across single events and series", () => {
		const parsed = parseFeed(
			calendar(
				vevent("past", "SUMMARY:Gone", "DTSTART;TZID=Europe/Brussels:20261001T100000"),
				vevent("series", "SUMMARY:Stand-up", "DTSTART;TZID=Europe/Brussels:20261005T090000", "RRULE:FREQ=WEEKLY;BYDAY=MO"),
				vevent("single", "SUMMARY:Workshop", "DTSTART;TZID=Europe/Brussels:20261112T090000"),
			),
			"example.com",
			BRU,
		);
		expect(nextOccurrence(parsed.events, "2026-11-10T00:00:00.000Z")).toMatchObject({ title: "Workshop" });
		expect(nextOccurrence(parsed.events, "2026-11-13T00:00:00.000Z")).toMatchObject({
			title: "Stand-up",
			startLocal: "2026-11-16T09:00:00",
		});
	});
});
