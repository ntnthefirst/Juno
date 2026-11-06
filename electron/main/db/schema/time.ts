import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { standardColumns } from "../columns";
import { clients, projects, referenceItems } from "./clients";

/**
 * Time spent on a project.
 *
 * A running timer is a row with no `ended_at` and no duration. Stopping fills
 * both in. Only one row per owner may be running at once, and the partial
 * unique index below is what holds that, so two windows racing to start a timer
 * cannot both win. A hand-entered row has both ends from the start: the
 * duration is whole minutes and is the figure that is summed, because a person
 * typing "1 h 30" means ninety, not whatever two timestamps happen to give.
 */
export const timeEntries = sqliteTable(
	"time_entries",
	{
		...standardColumns,
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		/** Copied from the project when the entry is made, so a report by client needs no join. */
		clientId: text("client_id").references(() => clients.id),
		/** UTC ISO-8601. */
		startedAt: text("started_at").notNull(),
		/** UTC ISO-8601. Null while the timer runs. */
		endedAt: text("ended_at"),
		/** Whole minutes. Null while the timer runs. */
		durationMinutes: integer("duration_minutes"),
		/** What was done. Shown as the title of the entry. */
		note: text("note"),
	},
	(t) => [
		index("time_entries_project_idx").on(t.projectId, t.deletedAt, t.startedAt),
		index("time_entries_client_idx").on(t.clientId),
		index("time_entries_owner_idx").on(t.ownerId),
		uniqueIndex("time_entries_one_running_idx")
			.on(t.ownerId)
			.where(sql`${t.endedAt} is null and ${t.deletedAt} is null`),
	],
);

/**
 * Where a project has been, for its timeline. A project's `status_id` only
 * holds where it is now, so each change is written down by the service, the
 * same way a client's is. Both ends are nullable: "no status" is a place.
 */
export const projectStatusChanges = sqliteTable(
	"project_status_changes",
	{
		...standardColumns,
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		fromStatusId: text("from_status_id").references(() => referenceItems.id),
		toStatusId: text("to_status_id").references(() => referenceItems.id),
		/** UTC ISO-8601. */
		changedAt: text("changed_at").notNull(),
	},
	(t) => [
		index("project_status_changes_project_idx").on(t.projectId, t.deletedAt, t.changedAt),
		index("project_status_changes_owner_idx").on(t.ownerId),
	],
);
