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
