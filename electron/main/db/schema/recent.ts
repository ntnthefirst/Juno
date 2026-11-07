import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";

/**
 * The records a person opened last, for the Recent menu in the title bar.
 *
 * One row per record, moved to the front when it is opened again. The service
 * keeps the newest twenty per owner. `record_id` is not a foreign key because
 * it points at one of several tables, named by `kind`.
 */
export const recentItems = sqliteTable(
	"recent_items",
	{
		...standardColumns,

		/** client, project, document or thread. */
		kind: text("kind").notNull(),
		recordId: text("record_id").notNull(),
		/** UTC ISO-8601. The last time the record was opened. */
		openedAt: text("opened_at").notNull(),
	},
	(t) => [
		uniqueIndex("recent_items_record_idx").on(t.ownerId, t.kind, t.recordId),
		index("recent_items_opened_idx").on(t.ownerId, t.deletedAt, t.openedAt),
	],
);
