import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { standardColumns } from "../columns";
import { mailMessages } from "./mail";

/**
 * What a person did with a suggestion made under a message: pressed Not now
 * (`dismissed`) or accepted it (`accepted`). Either way it is not offered for
 * that message again. The suggestions themselves are never stored, only the
 * answer, so a message that is edited or re-synced offers what it says now.
 */
export const mailSuggestionStates = sqliteTable(
	"mail_suggestion_states",
	{
		...standardColumns,
		messageId: text("message_id")
			.notNull()
			.references(() => mailMessages.id),
		/** event or project. */
		kind: text("kind").notNull(),
		/** dismissed or accepted. */
		state: text("state").notNull(),
	},
	(t) => [
		uniqueIndex("mail_suggestion_states_message_kind_idx")
			.on(t.ownerId, t.messageId, t.kind)
			.where(sql`deleted_at IS NULL`),
		index("mail_suggestion_states_message_idx").on(t.messageId),
	],
);
