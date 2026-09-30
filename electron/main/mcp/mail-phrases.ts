import type {
	MailAddress,
	MailPhraseKind,
	MailPhraseMessageKind,
	MailPhraseMode,
	MailPhrasePatch,
	MailPhraseRecipientKind,
	MailPhraseRuleInput,
	MailPhraseRulePatch,
} from "../../shared/types";
import * as phrases from "../services/mail-phrases";
import type { ToolDescriptor } from "./types";

/**
 * Greetings, sign-offs and the rules that pick them.
 *
 * Every write is confirmed. These only change the text a new message starts
 * with, and sending still has its own gate, but a rule quietly rewritten is a
 * sign-off changed on every mail from then on, and a person should see that
 * before it happens. `mail.phrases.resolve` only reads.
 *
 * Ids are ids: the phrase and account ids come from `mail.phrases.list` and
 * `mail.accounts.list`, never a title or an address to match on.
 */

const KINDS: MailPhraseKind[] = ["greeting", "signoff"];
const MESSAGE_KINDS: MailPhraseMessageKind[] = ["any", "new", "reply", "forward"];
const RECIPIENT_KINDS: MailPhraseRecipientKind[] = ["any", "client", "contact", "other"];
const MODES: MailPhraseMode[] = ["new", "reply", "forward"];

const ruleId = { type: "string", description: "The id of the rule, from mail.phrase_rules.list." };
const phraseId = { type: "string", description: "The id of the greeting or sign-off, from mail.phrases.list." };

const ruleFields = {
	name: { type: "string", description: "What the rule is called, like Replies to clients." },
	enabled: { type: "boolean", description: "A rule that is off is skipped. Defaults to true." },
	message_kind: {
		type: "string",
		enum: MESSAGE_KINDS,
		description: "Which messages it applies to: new, reply, forward, or any. Defaults to any.",
	},
	recipient_kind: {
		type: "string",
		enum: RECIPIENT_KINDS,
		description:
			"Who the message goes to: client (a client's address or contact), contact (an address that has " +
			"written to this mailbox), other, or any. Defaults to any.",
	},
	account_id: {
		type: ["string", "null"],
		description: "The mail account it applies to, from mail.accounts.list. Null means any account.",
	},
	greeting_id: {
		type: ["string", "null"],
		description: "The greeting it adds, a phrase of kind greeting. Null adds none.",
	},
	signoff_id: {
		type: ["string", "null"],
		description: "The sign-off it adds, a phrase of kind signoff. Null adds none.",
	},
};

/** Only what the caller sent, so an update never blanks a field by leaving it out. */
function ruleFrom(args: Record<string, unknown>): MailPhraseRulePatch {
	return {
		...(args.name !== undefined ? { name: String(args.name) } : {}),
		...(args.enabled !== undefined ? { enabled: Boolean(args.enabled) } : {}),
		...(args.message_kind !== undefined ? { messageKind: args.message_kind as MailPhraseMessageKind } : {}),
		...(args.recipient_kind !== undefined
			? { recipientKind: args.recipient_kind as MailPhraseRecipientKind }
			: {}),
		...(args.account_id !== undefined ? { accountId: args.account_id as string | null } : {}),
		...(args.greeting_id !== undefined ? { greetingId: args.greeting_id as string | null } : {}),
		...(args.signoff_id !== undefined ? { signoffId: args.signoff_id as string | null } : {}),
	};
}

function addressList(value: unknown): MailAddress[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(entry): entry is { name?: string | null; address: string } =>
				typeof entry === "object" && entry !== null && typeof (entry as { address?: unknown }).address === "string",
		)
		.map((entry) => ({ name: entry.name ?? null, address: entry.address }));
}

export const mailPhraseTools: ToolDescriptor[] = [
	{
		name: "mail.phrases.list",
		title: "List greetings and sign-offs",
		description:
			"Every greeting and sign-off: a title and a plain text that may span several lines. " +
			"Leave kind out for both, or pass greeting or signoff.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { kind: { type: "string", enum: KINDS, description: "Only this kind." } },
			additionalProperties: false,
		},
		handler: async (args) => phrases.listPhrases(args.kind as MailPhraseKind | undefined),
	},
	{
		name: "mail.phrases.create",
		title: "Add a greeting or sign-off",
		description:
			"Adds a named text the composer can put at the top (greeting) or bottom (signoff) of a message. " +
			"Plain text with line breaks, no placeholders. It is used only once a rule names it.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				kind: { type: "string", enum: KINDS },
				title: { type: "string", description: "What it is called in the lists, like Reply to clients." },
				text: { type: "string", description: "The text itself. Use line breaks for several lines." },
			},
			required: ["kind", "title", "text"],
			additionalProperties: false,
		},
		handler: async (args) =>
			phrases.createPhrase({
				kind: args.kind as MailPhraseKind,
				title: String(args.title),
				text: String(args.text),
			}),
	},
	{
		name: "mail.phrases.update",
		title: "Edit a greeting or sign-off",
		description:
			"Changes the title or the text. The kind cannot change. Rules that use it pick up the new text " +
			"for messages started from then on.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: phraseId,
				title: { type: "string" },
				text: { type: "string" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const patch: MailPhrasePatch = {
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.text !== undefined ? { text: String(args.text) } : {}),
			};
			return phrases.updatePhrase(String(args.id), patch);
		},
	},
	{
		name: "mail.phrases.delete",
		title: "Delete a greeting or sign-off",
		description:
			"Deletes one that no rule uses. Refused while a rule still names it, and the error says which, " +
			"so change that rule first.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: phraseId },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => phrases.deletePhrase(String(args.id)),
	},
	{
		name: "mail.phrases.resolve",
		title: "Find the greeting and sign-off for a message",
		description:
			"Which greeting and sign-off a message would start with: the first enabled rule, top to bottom, " +
			"whose conditions all match. Returns the rule id and the two texts, all null when no rule matches. " +
			"Changes nothing.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string", description: "The account the message is sent from." },
				mode: { type: "string", enum: MODES, description: "new, reply or forward." },
				to: {
					type: "array",
					description: "The addressees. Empty for a message with no recipient yet.",
					items: {
						type: "object",
						properties: { name: { type: ["string", "null"] }, address: { type: "string" } },
						required: ["address"],
						additionalProperties: false,
					},
				},
			},
			required: ["account_id", "mode"],
			additionalProperties: false,
		},
		handler: async (args) =>
			phrases.resolve({
				accountId: String(args.account_id),
				mode: args.mode as MailPhraseMode,
				to: addressList(args.to),
			}),
	},
	{
		name: "mail.phrase_rules.list",
		title: "List greeting and sign-off rules",
		description:
			"The rules in the order they are checked, top to bottom. The first enabled one that matches decides.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => phrases.listRules(),
	},
	{
		name: "mail.phrase_rules.create",
		title: "Add a greeting and sign-off rule",
		description:
			"Adds a rule at the bottom of the list. Its conditions all have to hold for it to apply, and it " +
			"names the greeting and the sign-off it adds, either of which may be none.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: ruleFields,
			required: ["name"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const input: MailPhraseRuleInput = { ...ruleFrom(args), name: String(args.name) };
			return phrases.createRule(input);
		},
	},
	{
		name: "mail.phrase_rules.update",
		title: "Edit a greeting and sign-off rule",
		description:
			"Changes the fields given and leaves the rest. Pass null for account_id, greeting_id or signoff_id " +
			"to clear it. To change the order, use mail.phrase_rules.reorder.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: ruleId, ...ruleFields },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => phrases.updateRule(String(args.id), ruleFrom(args)),
	},
	{
		name: "mail.phrase_rules.delete",
		title: "Delete a greeting and sign-off rule",
		description:
			"Deletes the rule. The greeting and sign-off it named are kept. Messages started from then on " +
			"fall through to the next matching rule.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: ruleId },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => phrases.deleteRule(String(args.id)),
	},
	{
		name: "mail.phrase_rules.reorder",
		title: "Reorder greeting and sign-off rules",
		description:
			"Sets the order the rules are checked in. Pass every rule id exactly once, first to last; " +
			"a partial list is refused.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Every rule id from mail.phrase_rules.list, in the new order.",
				},
			},
			required: ["ids"],
			additionalProperties: false,
		},
		handler: async (args) => {
			if (!Array.isArray(args.ids)) throw new Error("ids has to be a list of rule ids.");
			return phrases.reorderRules(args.ids.map(String));
		},
	},
];
