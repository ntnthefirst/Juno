import type { CalendarItem, CalendarOccurrence, CalendarReminderItem } from "@shared/types";
import { localDateOfInstant } from "./dates";

export type ScheduleRow =
	| { kind: "event"; key: string; date: string; item: CalendarOccurrence }
	| { kind: "reminder"; key: string; date: string; item: CalendarReminderItem };

/**
 * What a client's or a project's own list shows from a range query: events
 * that have not ended yet, once each even when they repeat, and every open
 * reminder, overdue ones included. Deadlines are left out because the project
 * already says when it is due.
 *
 * Soonest first. A series is represented by its next occurrence and says it
 * repeats; editing or deleting it from here applies to the whole series,
 * which is the only scope a list without a calendar grid can ask sensibly.
 */
export function scheduleRows(items: CalendarItem[], today: string): ScheduleRow[] {
	const rows: ScheduleRow[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (item.kind === "reminder") {
			rows.push({ kind: "reminder", key: `reminder|${item.reminderId}`, date: item.dueOn, item });
			continue;
		}
		if (item.kind !== "event") continue;
		if (seen.has(item.eventId)) continue;
		const date = item.allDay ? item.startLocal.slice(0, 10) : localDateOfInstant(item.startUtc);
		const endDate = item.allDay ? item.endLocal.slice(0, 10) : localDateOfInstant(item.endUtc);
		// An all-day end is exclusive, so a one-day event on `today` ends tomorrow.
		const over = item.allDay ? endDate <= today : endDate < today;
		if (over) continue;
		seen.add(item.eventId);
		rows.push({ kind: "event", key: `event|${item.eventId}`, date, item });
	}
	return rows.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
}
