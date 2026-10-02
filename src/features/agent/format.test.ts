import { describe, expect, it } from "vitest";
import { dayHeading, parseMailPreview, timeAgo, timeLeft } from "./format";
import { toolVisual } from "./tool-visual";

const NOW = new Date("2026-10-02T12:00:00").getTime();

describe("timeAgo and timeLeft", () => {
	it("says how long ago, in the unit that fits", () => {
		expect(timeAgo(new Date(NOW - 20_000).toISOString(), NOW)).toBe("just now");
		expect(timeAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5 min ago");
		expect(timeAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3 h ago");
		expect(timeAgo(new Date(NOW - 30 * 3_600_000).toISOString(), NOW)).toBe("yesterday");
	});

	it("says how long a request can still be approved", () => {
		expect(timeLeft(new Date(NOW + 23 * 3_600_000 + 10_000).toISOString(), NOW)).toBe("23 h left");
		expect(timeLeft(new Date(NOW + 40 * 60_000).toISOString(), NOW)).toBe("40 min left");
		expect(timeLeft(new Date(NOW - 1).toISOString(), NOW)).toBe("expired");
	});
});

describe("dayHeading", () => {
	it("names today and yesterday, and dates the rest", () => {
		expect(dayHeading("2026-10-02T09:00:00", NOW)).toBe("Today");
		expect(dayHeading("2026-10-01T23:00:00", NOW)).toBe("Yesterday");
		expect(dayHeading("2026-09-20T09:00:00", NOW)).toBe("20/09/2026");
	});
});

describe("parseMailPreview", () => {
	it("reads a mail request back into its headers and its text", () => {
		const parsed = parseMailPreview(
			"From: Nathan <hallo@juno.test>\nTo: Laura <laura@obet.be>\nCc: tom@obet.be\nSubject: Offerte\nAttached: Contract.pdf\n\nBeste Laura,\n\nTot snel.",
		);
		expect(parsed?.headers.map((h) => [h.label, h.value])).toEqual([
			["From", "Nathan <hallo@juno.test>"],
			["To", "Laura <laura@obet.be>"],
			["Cc", "tom@obet.be"],
			["Subject", "Offerte"],
			["Attached", "Contract.pdf"],
		]);
		expect(parsed?.body).toBe("Beste Laura,\n\nTot snel.");
	});

	it("leaves anything else alone", () => {
		expect(parseMailPreview("Just some text")).toBeNull();
		expect(parseMailPreview("From: a\nSubject: b\n\nno recipient")).toBeNull();
	});
});

describe("toolVisual", () => {
	it("tells what a tool works on and what it does to it", () => {
		expect(toolVisual("mail.send")).toEqual({ domain: "sent", verb: "send" });
		expect(toolVisual("mail.outbox.cancel")).toEqual({ domain: "sent", verb: "delete" });
		expect(toolVisual("mail.file.trash_messages")).toEqual({ domain: "inbox", verb: "file" });
		expect(toolVisual("clients.phones.create")).toEqual({ domain: "phone", verb: "create" });
		expect(toolVisual("reminders.complete")).toEqual({ domain: "reminders", verb: "done" });
		expect(toolVisual("reminders.restore")).toEqual({ domain: "reminders", verb: "restore" });
		expect(toolVisual("calendar.update_event")).toEqual({ domain: "calendar", verb: "change" });
		expect(toolVisual("unknown.thing")).toEqual({ domain: "agent", verb: "change" });
	});
});
