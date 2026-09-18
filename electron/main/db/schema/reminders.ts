import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { seededColumns, standardColumns } from "../columns";
import { clients, projects } from "./clients";
import { documents } from "./documents";

/**
 * A reminder is a date and a sentence. It may hang off a client, a project or a
 * document, or off nothing at all.
 *
 * Bureau tells you; it never acts. Decision 9: no invoice is generated, numbered
 * or sent, and no money moves. A reminder that says "time to invoice obet" points
 * at the accounting tool and stops there.
 */
export const reminders = sqliteTable(
	"reminders",
	{
		...standardColumns,
		...seededColumns,

		title: text("title").notNull(),
		notes: text("notes"),

		/** `YYYY-MM-DD`. A reminder has a date, not an instant. */
		dueOn: text("due_on").notNull(),

		/** once, days, weeks, months, years, quarter_end. See ../services/recurrence.ts. */
		pattern: text("pattern").notNull().default("once"),
		interval: integer("interval").notNull().default(1),
		/**
		 * Day of the month a monthly or yearly series is anchored to, so a series on
		 * the 31st returns to the 31st after February clamps it to the 28th.
		 */
		anchorDay: integer("anchor_day"),

		/** How many days before the due date this starts showing up. */
		leadDays: integer("lead_days").notNull().default(0),

		/**
		 * Loose grouping for the interface: paperwork, invoice, payment, renewal,
		 * other. Deliberately not a reference set: these drive behaviour in code,
		 * and a value the user could rename or hide would take the behaviour with it.
		 */
		category: text("category").notNull().default("other"),

		clientId: text("client_id").references(() => clients.id),
		projectId: text("project_id").references(() => projects.id),
		documentId: text("document_id").references(() => documents.id),

		/** Set while snoozed. The reminder stays open, it just stops shouting. */
		snoozedUntil: text("snoozed_until"),

		/** Set on a one-off that has been done. A recurring one rolls forward instead. */
		completedAt: text("completed_at"),
		lastCompletedOn: text("last_completed_on"),

		/** Where to go to actually do it, for the ones Bureau will not do itself. */
		actionUrl: text("action_url"),
		actionLabel: text("action_label"),
	},
	(t) => [
		index("reminders_due_idx").on(t.dueOn),
		index("reminders_client_idx").on(t.clientId),
		index("reminders_project_idx").on(t.projectId),
		index("reminders_owner_idx").on(t.ownerId),
		index("reminders_completed_idx").on(t.completedAt),
		index("reminders_deleted_idx").on(t.deletedAt),
	],
);

/**
 * One row per time a reminder was ticked off.
 *
 * Small, and it answers the question a recurring reminder actually raises: did I
 * do this last quarter? A single `lastCompletedOn` cannot.
 */
export const reminderCompletions = sqliteTable(
	"reminder_completions",
	{
		...standardColumns,
		reminderId: text("reminder_id")
			.notNull()
			.references(() => reminders.id),
		/** The date the occurrence was due, not the date it was ticked. */
		dueOn: text("due_on").notNull(),
		completedAt: text("completed_at").notNull(),
		note: text("note"),
	},
	(t) => [
		index("reminder_completions_reminder_idx").on(t.reminderId),
		index("reminder_completions_due_idx").on(t.dueOn),
	],
);
