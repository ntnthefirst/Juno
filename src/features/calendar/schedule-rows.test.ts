import { describe, expect, it } from "vitest";
import type { CalendarItem, CalendarOccurrence, CalendarReminderItem } from "@shared/types";
import { scheduleRows } from "./schedule-rows";

function event(over: Partial<CalendarOccurrence>): CalendarOccurrence {
	return {
		kind: "event",
		eventId: "e1",
		occurrenceStartLocal: "2026-10-05T10:00:00",
		title: "Kickoff",
		notes: null,
		location: null,
		allDay: false,
		timezone: "Europe/Brussels",
		startLocal: "2026-10-05T10:00:00",
		endLocal: "2026-10-05T11:00:00",
		startUtc: "2026-10-05T08:00:00.000Z",
		endUtc: "2026-10-05T09:00:00.000Z",
		isRecurring: false,
		isException: false,
		rrule: null,
		recurrenceLabel: "Does not repeat",
		clientId: null,
		clientName: null,
		projectId: null,
		projectName: null,
		...over,
	};
}

function reminder(over: Partial<CalendarReminderItem>): CalendarReminderItem {
	return {
		kind: "reminder",
		reminderId: "r1",
		title: "Send the draft",
		notes: null,
		dueOn: "2026-10-03",
		bucket: "soon",
		category: "other",
		recurrenceLabel: "Once",
		clientId: null,
		clientName: null,
		projectId: null,
		projectName: null,
		...over,
	};
}

describe("scheduleRows", () => {
	it("puts events and reminders in one list, soonest first", () => {
		const rows = scheduleRows([event({}), reminder({})], "2026-10-02");
		expect(rows.map((r) => r.item.title)).toEqual(["Send the draft", "Kickoff"]);
	});

	it("keeps an overdue reminder and drops an event that is over", () => {
		const items: CalendarItem[] = [
			reminder({ dueOn: "2026-09-20", bucket: "overdue" }),
			event({ eventId: "old", startUtc: "2026-09-20T08:00:00.000Z", endUtc: "2026-09-20T09:00:00.000Z" }),
		];
		const rows = scheduleRows(items, "2026-10-02");
		expect(rows.map((r) => r.kind)).toEqual(["reminder"]);
	});

	it("shows a repeating event once, as its next occurrence", () => {
		const rows = scheduleRows(
			[
				event({ isRecurring: true, startUtc: "2026-10-05T08:00:00.000Z", endUtc: "2026-10-05T09:00:00.000Z" }),
				event({ isRecurring: true, startUtc: "2026-10-12T08:00:00.000Z", endUtc: "2026-10-12T09:00:00.000Z" }),
			],
			"2026-10-02",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.date).toBe("2026-10-05");
	});

	it("treats the exclusive end of an all-day event as the day after it", () => {
		const yesterday = event({ allDay: true, startLocal: "2026-10-01", endLocal: "2026-10-02" });
		const today = event({ eventId: "t", allDay: true, startLocal: "2026-10-02", endLocal: "2026-10-03" });
		const rows = scheduleRows([yesterday, today], "2026-10-02");
		expect(rows.map((r) => r.key)).toEqual(["event|t"]);
	});

	it("leaves deadlines out", () => {
		const deadline: CalendarItem = {
			kind: "deadline",
			projectId: "p",
			projectName: "Site",
			clientId: null,
			clientName: null,
			dueOn: "2026-10-09",
		};
		expect(scheduleRows([deadline], "2026-10-02")).toEqual([]);
	});
});
