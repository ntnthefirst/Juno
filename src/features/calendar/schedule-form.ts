import { addLocalMinutes, joinLocal, todayIso } from "./dates";
import type { CalendarEvent, Reminder } from "@shared/types";
import type { ReminderSeed } from "../reminders/ReminderForm";
import type { EventSeed } from "./EventForm";

/**
 * A date or a reminder being written from a client or a project. The screen
 * that holds the client or project owns this state and draws the page instead
 * of its own content, the same as it does for a contact or a project.
 */
export type ScheduleForm =
	| { kind: "event"; event: CalendarEvent | null; seed: EventSeed }
	| { kind: "reminder"; reminder: Reminder | null; seed: ReminderSeed };

/** The last crumb of the trail while the form is open. */
export function scheduleFormLabel(form: ScheduleForm): string {
	if (form.kind === "event") return form.event ? "Edit date" : "New date";
	return form.reminder ? "Edit reminder" : "New reminder";
}

/** A new date at nine this morning for an hour, belonging to whatever called it. */
export function newEventForm(owner: { clientId?: string; projectId?: string }): ScheduleForm {
	const startLocal = joinLocal(todayIso(), "09:00");
	return {
		kind: "event",
		event: null,
		seed: {
			startLocal,
			endLocal: addLocalMinutes(startLocal, 60),
			allDay: false,
			...(owner.clientId ? { clientId: owner.clientId } : {}),
			...(owner.projectId ? { projectId: owner.projectId } : {}),
		},
	};
}

/** The form for an existing date or reminder, read fresh so an edit never starts from a stale copy. */
export async function editScheduleForm(target: { kind: "event" | "reminder"; id: string }): Promise<ScheduleForm> {
	if (target.kind === "event") {
		const event = await window.juno.calendar.get(target.id);
		if (!event) throw new Error("That event no longer exists.");
		return {
			kind: "event",
			event,
			seed: { startLocal: event.startLocal, endLocal: event.endLocal, allDay: event.allDay },
		};
	}
	const reminder = await window.juno.reminders.get(target.id);
	if (!reminder) throw new Error("That reminder no longer exists.");
	return { kind: "reminder", reminder, seed: {} };
}
