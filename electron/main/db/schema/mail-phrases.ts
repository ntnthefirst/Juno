import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { mailAccounts } from "./mail";

/**
 * A greeting or a sign-off: a named, static text the composer puts in a
 * message. Plain text, several lines allowed, no placeholders, so there is
 * nothing to fill in and nothing that can come out empty.
 *
 * Not seeded reference data. Nothing ships, so there is no is_system or
 * hidden_at: removing one is an ordinary soft delete, and the service refuses
 * while a live rule still points at it.
 */
export const mailPhrases = sqliteTable(
	"mail_phrases",
	{
		...standardColumns,
		/** "greeting" or "signoff". */
		kind: text("kind").notNull(),
		title: text("title").notNull(),
		text: text("text").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [
		index("mail_phrases_owner_idx").on(t.ownerId),
		index("mail_phrases_deleted_idx").on(t.deletedAt),
		index("mail_phrases_kind_order_idx").on(t.kind, t.sortOrder),
	],
);

/**
 * Which greeting and sign-off go on which message. Rules are checked top to
 * bottom by `sort_order`, then by id, and the first enabled one whose
 * conditions all match decides.
 *
 * A condition set to "any" (or, for the account, null) matches everything.
 * Either phrase may be null: a rule can add only a greeting or only a sign-off.
 */
export const mailPhraseRules = sqliteTable(
	"mail_phrase_rules",
	{
		...standardColumns,
		name: text("name").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		sortOrder: integer("sort_order").notNull().default(0),
		/** any, new, reply or forward. */
		messageKind: text("message_kind").notNull().default("any"),
		/** any, client, contact or other. */
		recipientKind: text("recipient_kind").notNull().default("any"),
		/** Null means any account. */
		accountId: text("account_id").references(() => mailAccounts.id),
		greetingId: text("greeting_id").references(() => mailPhrases.id),
		signoffId: text("signoff_id").references(() => mailPhrases.id),
	},
	(t) => [
		index("mail_phrase_rules_owner_idx").on(t.ownerId),
		index("mail_phrase_rules_deleted_idx").on(t.deletedAt),
		index("mail_phrase_rules_order_idx").on(t.sortOrder),
		index("mail_phrase_rules_account_idx").on(t.accountId),
		index("mail_phrase_rules_greeting_idx").on(t.greetingId),
		index("mail_phrase_rules_signoff_idx").on(t.signoffId),
	],
);
