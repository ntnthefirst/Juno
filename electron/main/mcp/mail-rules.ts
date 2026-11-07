import * as rules from "../services/mail-rules";
import type {
	MailRuleAction,
	MailRuleCondition,
	MailRuleInput,
	MailRuleMatch,
	MailRulePatch,
} from "../../shared/types";
import type { ToolDescriptor } from "./types";

/**
 * Mailbox rules. An agent can read them and can ask for one to be made, changed,
 * reordered or removed, and every one of those waits for the owner, who is shown
 * the whole rule in plain words first (decision 64).
 *
 * A rule files mail on its own, unattended, on every new message, which is what
 * sending and moving through `mail.file.*` is never allowed to do. So these tools
 * sit in the Send and file row, which cannot be set to Allow, and an automation
 * cannot call them at all. There is no tool that runs a rule: they run when the
 * mailbox syncs, on mail that arrives after the rule exists.
 *
 * Ids are ids. The account comes from mail.accounts.list and a folder from
 * mail.folders.list.
 */

const CONDITIONS = {
	type: "array",
	minItems: 1,
	maxItems: 10,
	description:
		"Tests on a new message. Each is one of: " +
		'{"kind":"text","field":"sender|recipient|subject","test":"contains|is|starts_with|ends_with|not_contains","value":"..."} ' +
		"(sender and recipient are addresses, never display names; text is compared as plain text, upper or lower case alike, and is never a pattern), " +
		'{"kind":"sender_is_client","value":true|false} or {"kind":"has_attachments","value":true|false}.',
	items: {
		type: "object",
		properties: {
			kind: { type: "string", enum: ["text", "sender_is_client", "has_attachments"] },
			field: { type: "string", enum: ["sender", "recipient", "subject"] },
			test: { type: "string", enum: ["contains", "is", "starts_with", "ends_with", "not_contains"] },
			value: { type: ["string", "boolean"] },
		},
		required: ["kind", "value"],
		additionalProperties: false,
	},
};

const ACTIONS = {
	type: "array",
	minItems: 1,
	maxItems: 6,
	description:
		"What to do with a message that matches, each at most once: mark_read, flag, link_client (link its conversation " +
		"to the client who sent it), and at most one of move (needs folder_id), trash or archive. A message that a " +
		"rule moves is not offered to the rules below it.",
	items: {
		type: "object",
		properties: {
			kind: { type: "string", enum: ["mark_read", "flag", "link_client", "move", "trash", "archive"] },
			folder_id: { type: "string", description: "For move: a folder id of the same account from mail.folders.list." },
		},
		required: ["kind"],
		additionalProperties: false,
	},
};

const MATCH = {
	type: "string",
	enum: ["all", "any"],
	description: "all: every condition has to hold. any: one is enough. Default all.",
};

const STOP = {
	type: "boolean",
	description: "True: a message this rule matches is not checked against the rules below it. Default false.",
};

function conditionsOf(value: unknown): MailRuleCondition[] {
	return Array.isArray(value) ? (value as MailRuleCondition[]) : [];
}

/** The tool's snake_case folder_id becomes the service's folderId. Nothing else is decided here. */
function actionsOf(value: unknown): MailRuleAction[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => {
		const { folder_id: folderId, ...rest } = (entry ?? {}) as Record<string, unknown>;
		return (folderId !== undefined ? { ...rest, folderId } : rest) as unknown as MailRuleAction;
	});
}

function patchOf(args: Record<string, unknown>): MailRulePatch {
	return {
		...(args.name !== undefined ? { name: String(args.name) } : {}),
		...(args.enabled !== undefined ? { enabled: Boolean(args.enabled) } : {}),
		...(args.match !== undefined ? { match: args.match as MailRuleMatch } : {}),
		...(args.conditions !== undefined ? { conditions: conditionsOf(args.conditions) } : {}),
		...(args.actions !== undefined ? { actions: actionsOf(args.actions) } : {}),
		...(args.stop_on_match !== undefined ? { stopOnMatch: Boolean(args.stop_on_match) } : {}),
	};
}

function createInput(args: Record<string, unknown>): MailRuleInput {
	return {
		accountId: String(args.account_id),
		name: String(args.name),
		conditions: conditionsOf(args.conditions),
		actions: actionsOf(args.actions),
		...(args.enabled !== undefined ? { enabled: Boolean(args.enabled) } : {}),
		...(args.match !== undefined ? { match: args.match as MailRuleMatch } : {}),
		...(args.stop_on_match !== undefined ? { stopOnMatch: Boolean(args.stop_on_match) } : {}),
	};
}

function ids(args: Record<string, unknown>): string[] {
	return Array.isArray(args.ids) ? args.ids.map(String) : [];
}

export const mailRuleTools: ToolDescriptor[] = [
	{
		name: "mail.rules.list",
		title: "List mailbox rules",
		description:
			"The rules of one mail account in the order they are checked, each with its conditions, its actions " +
			"and whether it is switched on. Rules act on new mail in the inbox after a sync, never on mail already there.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { account_id: { type: "string", description: "An account id from mail.accounts.list." } },
			required: ["account_id"],
			additionalProperties: false,
		},
		handler: async (args) => rules.list(String(args.account_id)),
	},
	{
		name: "mail.rules.get",
		title: "Get a mailbox rule",
		description: "One rule by id, with its conditions and actions.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "A rule id from mail.rules.list." } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => rules.get(String(args.id)),
	},
	{
		name: "mail.rules.history",
		title: "What mailbox rules did",
		description:
			"The newest things rules did to messages of an account, each naming the rule, the message, " +
			"the action and whether it happened, was skipped or failed and why. Answers why a message moved.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string", description: "An account id from mail.accounts.list." },
				rule_id: { type: "string", description: "Only this rule." },
				limit: { type: "integer", minimum: 1, maximum: 200, description: "How many, newest first. Default 50." },
			},
			required: ["account_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			rules.runs({
				accountId: String(args.account_id),
				...(args.rule_id !== undefined ? { ruleId: String(args.rule_id) } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
			}),
	},
	{
		name: "mail.rules.create",
		title: "Add a mailbox rule",
		description:
			"Asks to add a rule to the end of one account's list. A rule files mail by itself on every new message, " +
			"so this does not happen until the owner has read the whole rule in Juno and approved it. It then applies " +
			"only to mail that arrives later, never to mail already in the mailbox.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string", description: "An account id from mail.accounts.list." },
				name: { type: "string", description: "What the owner calls it, like Newsletters." },
				enabled: { type: "boolean", description: "Whether it runs once approved. Default true." },
				match: MATCH,
				conditions: CONDITIONS,
				actions: ACTIONS,
				stop_on_match: STOP,
			},
			required: ["account_id", "name", "conditions", "actions"],
			additionalProperties: false,
		},
		handler: async (args) => rules.create(createInput(args)),
		prepare: async (args) => rules.reviewCreate(createInput(args)),
		verify: async (args, seal) => rules.verifySeal(rules.reviewCreate(createInput(args)), seal),
	},
	{
		name: "mail.rules.update",
		title: "Change a mailbox rule",
		description:
			"Asks to change a rule. Fields left out stay as they are. The owner is shown the rule as it is and as it " +
			"would become, and nothing changes until they approve.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "A rule id from mail.rules.list." },
				name: { type: "string" },
				enabled: { type: "boolean", description: "False switches it off without removing it." },
				match: MATCH,
				conditions: CONDITIONS,
				actions: ACTIONS,
				stop_on_match: STOP,
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => rules.update(String(args.id), patchOf(args)),
		prepare: async (args) => rules.reviewUpdate(String(args.id), patchOf(args)),
		verify: async (args, seal) => rules.verifySeal(rules.reviewUpdate(String(args.id), patchOf(args)), seal),
	},
	{
		name: "mail.rules.reorder",
		title: "Reorder mailbox rules",
		description:
			"Asks to set the order one account's rules are checked in. Pass every rule id of the account exactly once, " +
			"first is checked first. The owner approves the new order before it applies.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string", description: "An account id from mail.accounts.list." },
				ids: { type: "array", items: { type: "string" }, description: "Every rule id of that account, in the new order." },
			},
			required: ["account_id", "ids"],
			additionalProperties: false,
		},
		handler: async (args) => rules.reorder(String(args.account_id), ids(args)),
		prepare: async (args) => rules.reviewReorder(String(args.account_id), ids(args)),
		verify: async (args, seal) => rules.verifySeal(rules.reviewReorder(String(args.account_id), ids(args)), seal),
	},
	{
		name: "mail.rules.delete",
		title: "Remove a mailbox rule",
		description:
			"Asks to remove a rule. What it already did stays in the history, and mail it moved stays where it went.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "A rule id from mail.rules.list." } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => rules.remove(String(args.id)),
		prepare: async (args) => rules.reviewRemove(String(args.id)),
		verify: async (args, seal) => rules.verifySeal(rules.reviewRemove(String(args.id)), seal),
	},
];
