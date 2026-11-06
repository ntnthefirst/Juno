import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";

/**
 * An intro or an outro: a line added at the start or the end of a message, with
 * one rule for when it is added on its own.
 *
 * Ordinary rows, owned by the person. Nothing about them is a system row, so a
 * reset or an upgrade never touches them (the examples a first install gets are
 * written once, see `ensureMailBlocksSeeded`).
 */
export const mailBlocks = sqliteTable(
	"mail_blocks",
	{
		...standardColumns,

		/** intro or outro. */
		kind: text("kind").notNull(),
		name: text("name").notNull(),
		/** What a client reads, Dutch. Variables are stored as {{name}} tokens. */
		body: text("body").notNull(),
		/** manual, client, new_contact, reply or project. */
		rule: text("rule").notNull().default("manual"),
		/** The owner's order within a kind. Lower wins when two blocks match. */
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [index("mail_blocks_list_idx").on(t.ownerId, t.deletedAt, t.kind, t.sortOrder)],
);
