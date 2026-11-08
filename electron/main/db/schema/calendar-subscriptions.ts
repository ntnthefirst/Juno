import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { mailAccounts } from "./mail";

/**
 * A calendar Juno reads from an https address and keeps up to date by itself:
 * Google's secret iCal address, an Outlook published calendar, public
 * holidays, a booking tool. Read only.
 *
 * The address itself is not here. A Google secret address is a password in
 * all but name (anyone holding it reads the calendar), so it is kept by the
 * credential store under `credential_key`, like a mail password, and this row
 * holds only what is safe to show: the host, and a hash of the address so the
 * same calendar is not added twice (security.md section 1).
 */
export const calendarSubscriptions = sqliteTable(
	"calendar_subscriptions",
	{
		...standardColumns,

		name: text("name").notNull(),
		/** Where the address points, for the settings row: `calendar.google.com`. */
		host: text("host").notNull(),
		/** SHA-256 of the address as stored, so a second subscription to it is refused. */
		urlHash: text("url_hash").notNull(),
		/** The key the address is stored under in the credential store. Never the address. */
		credentialKey: text("credential_key").notNull(),
		/** A colour token name such as `accent`, `seal` or `tone-3-ink`. Never a hex value. */
		colour: text("colour").notNull(),
		/** 15, 60 or 1440. */
		refreshMinutes: integer("refresh_minutes").notNull().default(60),
		/** Drawn on the calendar. Hiding it keeps the events and the fetching. */
		shown: integer("shown", { mode: "boolean" }).notNull().default(true),

		/** The last fetch that succeeded, including a 304 that said nothing changed. */
		lastFetchedAt: text("last_fetched_at"),
		/** The last fetch tried, whatever came of it. The schedule counts from this. */
		lastAttemptAt: text("last_attempt_at"),
		/** Why the last fetch failed, in plain words, or null when it did not. */
		lastError: text("last_error"),
		etag: text("etag"),
		lastModified: text("last_modified"),
		eventCount: integer("event_count").notNull().default(0),

		/** The mail account it came with, when it was added from one. */
		mailAccountId: text("mail_account_id").references(() => mailAccounts.id),
	},
	(t) => [
		index("calendar_subscriptions_owner_idx").on(t.ownerId, t.deletedAt),
		index("calendar_subscriptions_account_idx").on(t.mailAccountId),
		uniqueIndex("calendar_subscriptions_url_idx")
			.on(t.ownerId, t.urlHash)
			.where(sql`deleted_at IS NULL`),
	],
);

/**
 * An event as the feed last described it: a single event, or the master of a
 * series with its changed and cancelled occurrences.
 *
 * Its own table rather than rows in `calendar_events`, so that every query,
 * edit, export and agent tool written against Juno's own events stays exactly
 * as it is and cannot reach one of these. The calendar asks for them by range
 * beside its own events and draws them read only.
 *
 * The shape follows `calendar_events` (decision 23): a wall clock and a zone,
 * with the instants only for the range index. Exceptions are kept as JSON on
 * the row because nothing edits them: each fetch replaces them whole.
 */
export const calendarSubscriptionEvents = sqliteTable(
	"calendar_subscription_events",
	{
		...standardColumns,

		subscriptionId: text("subscription_id")
			.notNull()
			.references(() => calendarSubscriptions.id),
		/** The feed's UID, so a later fetch updates the row instead of adding another. */
		icalUid: text("ical_uid").notNull(),

		title: text("title").notNull(),
		notes: text("notes"),
		location: text("location"),
		allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
		startLocal: text("start_local").notNull(),
		endLocal: text("end_local").notNull(),
		timezone: text("timezone").notNull(),
		rrule: text("rrule"),
		startUtc: text("start_utc").notNull(),
		endUtc: text("end_utc").notNull(),
		seriesEndUtc: text("series_end_utc"),
		/** The changed and cancelled occurrences, as `IcsException[]`. */
		exceptionsJson: text("exceptions_json").notNull().default("[]"),
	},
	(t) => [
		uniqueIndex("calendar_subscription_events_uid_idx").on(t.subscriptionId, t.icalUid),
		index("calendar_subscription_events_range_idx").on(t.deletedAt, t.startUtc),
		index("calendar_subscription_events_series_end_idx").on(t.seriesEndUtc),
		index("calendar_subscription_events_owner_idx").on(t.ownerId),
	],
);
