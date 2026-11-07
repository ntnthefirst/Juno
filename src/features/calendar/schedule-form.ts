import type { CalendarEvent, Reminder } from "@shared/types";

/**
 * A date or a reminder being edited from a client or a project. The screen that
 * holds the client or project owns this state and draws the page instead of its
 * own content, the same as it does for a contact or a project. Making a new
 * one opens its own window (decision 60), so there is no empty form here.
 */
export type ScheduleForm = { kind: "event"; event: CalendarEvent } | { kind: "reminder"; reminder: Reminder };

/** The last crumb of the trail while the form is open. */
export function scheduleFormLabel(form: ScheduleForm): string {
	return form.kind === "event" ? "Edit date" : "Edit reminder";
}

/** The form for an existing date or reminder, read fresh so an edit never starts from a stale copy. */
export async function editScheduleForm(target: { kind: "event" | "reminder"; id: string }): Promise<ScheduleForm> {
	if (target.kind === "event") {
		const event = await window.juno.calendar.get(target.id);
		if (!event) throw new Error("That event no longer exists.");
		return { kind: "event", event };
	}
	const reminder = await window.juno.reminders.get(target.id);
	if (!reminder) throw new Error("That reminder no longer exists.");
	return { kind: "reminder", reminder };
}
