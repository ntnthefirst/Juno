import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { mailAccounts } from "./mail";

/**
 * A rule the owner wrote for one mailbox: tests on a new message, and what to do
 * with the ones that pass. Ordinary rows, checked from the lowest `sort_order`
 * up. Conditions and actions are JSON, validated by `services/mail-rules.ts`
 * before they are written and again before they are used.
 */
export const mailRules = sqliteTable(
	"mail_rules",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		name: text("name").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		/** all or any. */
		matchMode: text("match_mode").notNull().default("all"),
		conditionsJson: text("conditions_json").notNull().default("[]"),
		actionsJson: text("actions_json").notNull().default("[]"),
		stopOnMatch: integer("stop_on_match", { mode: "boolean" }).notNull().default(false),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [
		index("mail_rules_list_idx").on(t.accountId, t.deletedAt, t.sortOrder),
		index("mail_rules_deleted_idx").on(t.deletedAt),
	],
);

/**
 * What a rule did to a message, one row per action. This is the answer to "why
 * did this message move". `rule_name`, `subject` and `from_address` are copies,
 * because the rule may be renamed or removed and the message may be gone.
 * `message_id` is the local id and has no foreign key: purging an account's mail
 * must not take its history with it.
 */
export const mailRuleRuns = sqliteTable(
	"mail_rule_runs",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		ruleId: text("rule_id")
			.notNull()
			.references(() => mailRules.id),
		ruleName: text("rule_name").notNull(),
		messageId: text("message_id").notNull(),
		subject: text("subject").notNull().default(""),
		fromAddress: text("from_address"),
		/** move, trash, archive, mark_read, flag or link_client. */
		action: text("action").notNull(),
		detail: text("detail"),
		/** done, skipped or failed. */
		result: text("result").notNull(),
		error: text("error"),
	},
	(t) => [
		index("mail_rule_runs_account_idx").on(t.accountId, t.createdAt),
		index("mail_rule_runs_rule_idx").on(t.ruleId, t.createdAt),
		index("mail_rule_runs_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A message the rules have already looked at, kept by its Message-ID rather than
 * by its local id or its UID. A UIDVALIDITY change throws the local rows away
 * and pulls the same mail back under new ones, and a message moved back into the
 * inbox arrives with a new UID too: the key is what makes neither of them a new
 * message. Rows are never removed.
 */
export const mailRuleSeen = sqliteTable(
	"mail_rule_seen",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		/** The Message-ID, lower case, or a hash of the headers for a message without one. */
		messageKey: text("message_key").notNull(),
	},
	(t) => [
		uniqueIndex("mail_rule_seen_key_idx").on(t.accountId, t.messageKey),
		index("mail_rule_seen_deleted_idx").on(t.deletedAt),
	],
);
