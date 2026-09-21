import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { clients, projects } from "./clients";

/**
 * A calendar event, or the master of a recurring series.
 *
 * Times are stored twice, on purpose. `start_local` and `end_local` are the
 * wall-clock values in `timezone`, which is what a recurring event actually
 * means: a call at 10:00 Brussels time is at 10:00 after the clocks change too.
 * `start_utc` and `end_utc` are the first occurrence as instants, kept only so
 * a range query can be indexed. Expanding a series always starts from the
 * wall-clock values; deriving them back from UTC is the bug decision 11 and
 * PLAN.md phase 5 both warn about.
 */
export const calendarEvents = sqliteTable(
	"calendar_events",
	{
		...standardColumns,

		title: text("title").notNull(),
		notes: text("notes"),
		location: text("location"),

		allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),

		/**
		 * `YYYY-MM-DDTHH:MM:SS` for a timed event, `YYYY-MM-DD` for an all-day one.
		 * No zone suffix: the zone is the column beside it.
		 */
		startLocal: text("start_local").notNull(),
		/** Exclusive, like DTEND. A one-day all-day event ends on the next date. */
		endLocal: text("end_local").notNull(),
		/** IANA name, `Europe/Brussels`. Stored per event, never assumed. */
		timezone: text("timezone").notNull(),

		/** RFC 5545 rule without the `RRULE:` prefix, null for a single event. */
		rrule: text("rrule"),

		/** The first occurrence as instants, for the range index only. */
		startUtc: text("start_utc").notNull(),
		endUtc: text("end_utc").notNull(),
		/**
		 * When the last occurrence ends, so a range query can skip a series that
		 * is over. Null means the series has no end.
		 */
		seriesEndUtc: text("series_end_utc"),

		/** Stable across export and import, so a re-import updates instead of duplicating. */
		icalUid: text("ical_uid").notNull(),

		clientId: text("client_id").references(() => clients.id),
		projectId: text("project_id").references(() => projects.id),
	},
	(t) => [
		index("calendar_events_owner_idx").on(t.ownerId),
		index("calendar_events_start_idx").on(t.startUtc),
		index("calendar_events_series_end_idx").on(t.seriesEndUtc),
		index("calendar_events_uid_idx").on(t.ownerId, t.icalUid),
		index("calendar_events_client_idx").on(t.clientId),
		index("calendar_events_project_idx").on(t.projectId),
		index("calendar_events_deleted_idx").on(t.deletedAt),
	],
);

/**
 * One occurrence of a series that differs from what the rule says: cancelled,
 * or moved and edited. Keyed by the wall-clock start the rule generated, which
 * is what RECURRENCE-ID carries in an .ics file.
 *
 * Only the columns that are set override the master. A moved occurrence with
 * the same title has a null title here.
 */
export const calendarEventExceptions = sqliteTable(
	"calendar_event_exceptions",
	{
		...standardColumns,

		eventId: text("event_id")
			.notNull()
			.references(() => calendarEvents.id),
		/** The start the rule would have produced, in the master's zone. */
		occurrenceStartLocal: text("occurrence_start_local").notNull(),

		cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),

		title: text("title"),
		notes: text("notes"),
		location: text("location"),
		startLocal: text("start_local"),
		endLocal: text("end_local"),
	},
	(t) => [
		index("calendar_event_exceptions_event_idx").on(t.eventId, t.occurrenceStartLocal),
		index("calendar_event_exceptions_deleted_idx").on(t.deletedAt),
	],
);
