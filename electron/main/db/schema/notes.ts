import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { clients, projects } from "./clients";

/**
 * A note is something written down for its own sake: a checklist, a price
 * list, an idea. It may belong to a client or a project, or to nothing.
 *
 * It is not a `client_notes` row. Those are entries on a client's timeline
 * (a call, a meeting) with a moment they happened at, and they cannot exist
 * without a client. A note has a title of its own, a body that is edited in
 * place, and no owner at all unless the person gives it one.
 *
 * Search runs on `notes_fts`, an FTS5 table kept in step by triggers in the
 * migration, because drizzle cannot declare a virtual table.
 */
export const notes = sqliteTable(
	"notes",
	{
		...standardColumns,
		title: text("title").notNull().default(""),
		/** Markdown. A checklist is `- [ ] item` and `- [x] item`. */
		body: text("body").notNull().default(""),
		clientId: text("client_id").references(() => clients.id),
		projectId: text("project_id").references(() => projects.id),
		/** UTC ISO-8601. Set while the note is pinned to the top of the list. */
		pinnedAt: text("pinned_at"),
	},
	(t) => [
		index("notes_owner_idx").on(t.ownerId, t.deletedAt, t.updatedAt),
		index("notes_client_idx").on(t.clientId),
		index("notes_project_idx").on(t.projectId),
	],
);
