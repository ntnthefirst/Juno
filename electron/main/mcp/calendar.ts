import type { CalendarEditTarget, CalendarEventPatch, CalendarScope } from "../../shared/types";
import * as calendar from "../services/calendar";
import type { ToolDescriptor } from "./types";

/**
 * Calendar tools. Phase 5.
 *
 * Times cross this boundary as a wall clock plus an IANA zone, never as a
 * bare instant, because "10:00 in Brussels every Tuesday" is what a recurring
 * event means and what survives a DST change. A range query returns both
 * forms, so a caller can show one and reason about the other.
 *
 * Nothing here sends an invitation or talks to another calendar. Import and
 * export are files, and CalDAV is a later phase (decision 11).
 */

const SCOPES: CalendarScope[] = ["this", "following", "all"];

const LOCAL_TIME = {
	type: "string",
	description:
		"Wall-clock time with no zone suffix, like 2026-03-14T10:00. A date on its own, like 2026-03-14, for an all-day event.",
};

const TARGET_PROPERTIES = {
	scope: {
		type: "string",
		enum: SCOPES,
		description:
			"For a recurring event: this occurrence only, this and every following one, or all. A single event ignores it.",
	},
	occurrence_start_local: {
		type: "string",
		description:
			"For scope this or following: the occurrence_start_local of the occurrence in question, as calendar.list_events returned it.",
	},
};

function targetOf(args: Record<string, unknown>): CalendarEditTarget {
	return {
		scope: (args.scope as CalendarScope | undefined) ?? "all",
		...(args.occurrence_start_local !== undefined
			? { occurrenceStartLocal: String(args.occurrence_start_local) }
			: {}),
	};
}

export const calendarTools: ToolDescriptor[] = [
	{
		name: "calendar.list_events",
		title: "List what is on the calendar",
		description:
			"Every occurrence between two dates, expanded from recurring rules with exceptions applied, " +
			"in order. Each item has start_utc and end_utc as instants and start_local and end_local as " +
			"the wall clock in the event's own zone. Reminders and project deadlines can be overlaid as " +
			"read-only items. At most 400 days at a time.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				from: { type: "string", description: "First date of the range, YYYY-MM-DD, inclusive." },
				to: { type: "string", description: "Last date of the range, YYYY-MM-DD, inclusive." },
				timezone: {
					type: "string",
					description: "IANA zone the dates are read in. Leave out for the machine's zone.",
				},
				include_reminders: { type: "boolean", description: "Overlay open reminders due in the range." },
				include_deadlines: { type: "boolean", description: "Overlay project due dates in the range." },
				client_id: { type: "string" },
				project_id: { type: "string" },
			},
			required: ["from", "to"],
			additionalProperties: false,
		},
		handler: async (args) =>
			calendar.listRange({
				from: String(args.from),
				to: String(args.to),
				...(args.timezone ? { timezone: String(args.timezone) } : {}),
				includeReminders: args.include_reminders === true,
				includeDeadlines: args.include_deadlines === true,
				...(args.client_id ? { clientId: String(args.client_id) } : {}),
				...(args.project_id ? { projectId: String(args.project_id) } : {}),
			}),
	},
	{
		name: "calendar.get_event",
		title: "Read an event",
		description:
			"One event as stored: the master of a series with its rule and its exceptions, or a single " +
			"event. For what actually lands on a given day, use calendar.list_events.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => calendar.get(String(args.id)),
	},
	{
		name: "calendar.create_event",
		title: "Create an event",
		description:
			"Adds an event, or a recurring series when rrule is given. Times are a wall clock in the " +
			"event's zone. The end defaults to an hour after the start, or one day for an all-day event.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				start_local: LOCAL_TIME,
				end_local: { ...LOCAL_TIME, description: `Exclusive. ${LOCAL_TIME.description}` },
				all_day: { type: "boolean" },
				timezone: {
					type: "string",
					description: "IANA zone, like Europe/Brussels. Leave out for the machine's zone.",
				},
				rrule: {
					type: ["string", "null"],
					description:
						"RFC 5545 recurrence rule without the RRULE: prefix, like FREQ=WEEKLY;BYDAY=TU or " +
						"FREQ=MONTHLY;BYMONTHDAY=1;COUNT=12. Daily, weekly, monthly or yearly only.",
				},
				notes: { type: ["string", "null"] },
				location: { type: ["string", "null"] },
				client_id: { type: ["string", "null"] },
				project_id: {
					type: ["string", "null"],
					description: "Also sets the client, which has to be the project's own.",
				},
			},
			required: ["title", "start_local"],
			additionalProperties: false,
		},
		handler: async (args) =>
			calendar.create({
				title: String(args.title),
				startLocal: String(args.start_local),
				...(args.end_local !== undefined ? { endLocal: String(args.end_local) } : {}),
				...(args.all_day !== undefined ? { allDay: args.all_day === true } : {}),
				...(args.timezone ? { timezone: String(args.timezone) } : {}),
				...(args.rrule !== undefined ? { rrule: args.rrule as string | null } : {}),
				notes: (args.notes as string | null) ?? null,
				location: (args.location as string | null) ?? null,
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
			}),
	},
	{
		name: "calendar.update_event",
		title: "Edit an event",
		description:
			"Changes an event. For a series, say which occurrences: scope this writes an exception for " +
			"one occurrence, following splits the series from that occurrence on, all changes the " +
			"master and carries its exceptions along. A start moved without an end keeps the length. " +
			"Returns the event that now holds the edited occurrences; for following that is a new series.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				...TARGET_PROPERTIES,
				title: { type: "string" },
				start_local: LOCAL_TIME,
				end_local: LOCAL_TIME,
				all_day: { type: "boolean", description: "Whole series only." },
				timezone: { type: "string", description: "Whole series only." },
				rrule: { type: ["string", "null"], description: "Whole series only. Null stops it repeating." },
				notes: { type: ["string", "null"] },
				location: { type: ["string", "null"] },
				client_id: { type: ["string", "null"], description: "Whole series only." },
				project_id: { type: ["string", "null"], description: "Whole series only." },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const patch: CalendarEventPatch = {
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.start_local !== undefined ? { startLocal: String(args.start_local) } : {}),
				...(args.end_local !== undefined ? { endLocal: String(args.end_local) } : {}),
				...(args.all_day !== undefined ? { allDay: args.all_day === true } : {}),
				...(args.timezone !== undefined ? { timezone: String(args.timezone) } : {}),
				...(args.rrule !== undefined ? { rrule: args.rrule as string | null } : {}),
				...(args.notes !== undefined ? { notes: args.notes as string | null } : {}),
				...(args.location !== undefined ? { location: args.location as string | null } : {}),
				...(args.client_id !== undefined ? { clientId: args.client_id as string | null } : {}),
				...(args.project_id !== undefined ? { projectId: args.project_id as string | null } : {}),
			};
			return calendar.update(String(args.id), patch, targetOf(args));
		},
	},
	{
		name: "calendar.remove_event",
		title: "Remove an event",
		description:
			"Removes an event or part of a series. Scope this cancels one occurrence, following ends " +
			"the series before that occurrence, all removes the whole event. Only all is reversible, " +
			"with calendar.restore_event.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, ...TARGET_PROPERTIES },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => calendar.remove(String(args.id), targetOf(args)),
	},
	{
		name: "calendar.restore_event",
		title: "Restore a removed event",
		description: "Brings back an event removed with scope all.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => calendar.restore(String(args.id)),
	},
	{
		name: "calendar.export_ics",
		title: "Export a date range as iCalendar text",
		description:
			"The .ics text for every event with an occurrence between two dates. A series is written " +
			"whole, with its rule and exceptions, and timed events carry their zone. Nothing is written " +
			"to disk; the caller decides where the text goes.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				from: { type: "string", description: "YYYY-MM-DD, inclusive." },
				to: { type: "string", description: "YYYY-MM-DD, inclusive." },
				timezone: { type: "string", description: "IANA zone the dates are read in." },
			},
			required: ["from", "to"],
			additionalProperties: false,
		},
		handler: async (args) =>
			calendar.exportIcs({
				from: String(args.from),
				to: String(args.to),
				...(args.timezone ? { timezone: String(args.timezone) } : {}),
			}),
	},
	{
		name: "calendar.import_ics",
		title: "Import iCalendar text",
		description:
			"Reads .ics text into the calendar. An event whose UID is already here is updated in place, " +
			"so the same file twice changes nothing. Returns counts and any warnings about times that " +
			"could not be kept exactly.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				ics: { type: "string", description: "The whole file, as text." },
				timezone: {
					type: "string",
					description: "Zone for times the file leaves floating or in UTC. Leave out for the machine's zone.",
				},
			},
			required: ["ics"],
			additionalProperties: false,
		},
		handler: async (args) =>
			calendar.importIcs(String(args.ics), undefined, args.timezone ? String(args.timezone) : undefined),
	},
];
