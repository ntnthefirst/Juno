/**
 * Mailbox rules as data: how a message is tested against one, and how a rule
 * reads in plain words.
 *
 * Pure functions with no database in them, so the service that runs the rules,
 * the approval preview an agent's request shows and the list in settings all use
 * one definition of "matches" and one of "what this does".
 *
 * **Nothing here evaluates text it was given.** A condition value is compared
 * with `includes`, `startsWith`, `endsWith` or `===`, never turned into a
 * pattern, and the message's own fields are attacker text: they are cut to a
 * fixed length before anything looks at them, so a hundred-kilobyte subject costs
 * the same as a short one.
 */
import type {
	MailRule,
	MailRuleAction,
	MailRuleActionKind,
	MailRuleCondition,
	MailRuleTextField,
	MailRuleTextTest,
} from "./types";

export const MAIL_RULE_TEXT_FIELDS: MailRuleTextField[] = ["sender", "recipient", "subject"];
export const MAIL_RULE_TEXT_TESTS: MailRuleTextTest[] = ["contains", "is", "starts_with", "ends_with", "not_contains"];
export const MAIL_RULE_ACTION_KINDS: MailRuleActionKind[] = [
	"mark_read",
	"flag",
	"link_client",
	"move",
	"trash",
	"archive",
];
/** The actions that put a message somewhere else. A rule has at most one. */
export const MAIL_RULE_MOVING_KINDS: MailRuleActionKind[] = ["move", "trash", "archive"];

export const MAX_RULE_NAME = 100;
export const MAX_RULE_VALUE = 200;
export const MAX_RULE_CONDITIONS = 10;
export const MAX_RULES_PER_ACCOUNT = 100;
/** What a message field is cut to before it is compared. */
export const MAX_MATCHED_TEXT = 1000;
const MAX_RECIPIENTS = 200;

export function isMovingAction(action: MailRuleAction): boolean {
	return MAIL_RULE_MOVING_KINDS.includes(action.kind);
}

/** The facts about one message that a rule can look at. */
export interface MailRuleFacts {
	/** The address the message came from, not the name shown beside it. */
	senderAddress: string;
	/** Every To and Cc address. */
	recipientAddresses: string[];
	subject: string;
	senderIsClient: boolean;
	hasAttachments: boolean;
}

/**
 * Text as it is compared: cut short, composed into one form, stripped of the
 * invisible characters that make two identical-looking strings differ, and
 * lower case. Applied to both sides, so what a person typed and what arrived
 * meet in the same form.
 */
export function foldForMatch(text: string): string {
	return text
		.slice(0, MAX_MATCHED_TEXT)
		.normalize("NFKC")
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
		.toLowerCase();
}

function passes(test: MailRuleTextTest, haystack: string, needle: string): boolean {
	switch (test) {
		case "contains":
		case "not_contains":
			return haystack.includes(needle);
		case "is":
			return haystack === needle;
		case "starts_with":
			return haystack.startsWith(needle);
		case "ends_with":
			return haystack.endsWith(needle);
	}
}

export function conditionMatches(condition: MailRuleCondition, facts: MailRuleFacts): boolean {
	if (condition.kind === "sender_is_client") return facts.senderIsClient === condition.value;
	if (condition.kind === "has_attachments") return facts.hasAttachments === condition.value;

	const needle = foldForMatch(condition.value).trim();
	if (needle === "") return false;

	if (condition.field === "subject") {
		const found = passes(condition.test, foldForMatch(facts.subject), needle);
		return condition.test === "not_contains" ? !found : found;
	}
	if (condition.field === "sender") {
		const found = passes(condition.test, foldForMatch(facts.senderAddress).trim(), needle);
		return condition.test === "not_contains" ? !found : found;
	}
	// Recipients: "contains" and the others hold when any recipient passes. "Does
	// not contain" holds only when none does, which is what the words say.
	const folded = facts.recipientAddresses.slice(0, MAX_RECIPIENTS).map((address) => foldForMatch(address).trim());
	const any = folded.some((address) => passes(condition.test, address, needle));
	return condition.test === "not_contains" ? !any : any;
}

/** A rule with no conditions never matches: "every message" is not something to do by accident. */
export function ruleMatches(
	rule: Pick<MailRule, "conditions" | "match">,
	facts: MailRuleFacts,
): boolean {
	if (rule.conditions.length === 0) return false;
	return rule.match === "any"
		? rule.conditions.some((condition) => conditionMatches(condition, facts))
		: rule.conditions.every((condition) => conditionMatches(condition, facts));
}

/** The order a rule's actions are carried out in: what keeps the message in place first, what moves it last. */
export function orderedActions(actions: MailRuleAction[]): MailRuleAction[] {
	const rank = (action: MailRuleAction) => MAIL_RULE_ACTION_KINDS.indexOf(action.kind);
	return [...actions].sort((a, b) => rank(a) - rank(b));
}

/* ------------------------------------------------------------ plain words */

const FIELD_WORDS: Record<MailRuleTextField, string> = {
	sender: "the sender's address",
	recipient: "a recipient's address",
	subject: "the subject",
};

/**
 * A name or a value in quotes. A quote inside it becomes an apostrophe, so text that
 * somebody else wrote cannot end the quotation early and pass for the sentence
 * around it in an approval.
 */
function quote(value: string): string {
	return `"${value.replace(/"/g, "'")}"`;
}

export function describeCondition(condition: MailRuleCondition): string {
	if (condition.kind === "sender_is_client") {
		return condition.value ? "the sender is a client" : "the sender is not a client";
	}
	if (condition.kind === "has_attachments") {
		return condition.value ? "it has attachments" : "it has no attachments";
	}
	const value = quote(condition.value);
	if (condition.field === "recipient" && condition.test === "not_contains") {
		return `no recipient's address contains ${value}`;
	}
	const subject = FIELD_WORDS[condition.field];
	switch (condition.test) {
		case "contains":
			return `${subject} contains ${value}`;
		case "not_contains":
			return `${subject} does not contain ${value}`;
		case "is":
			return `${subject} is ${value}`;
		case "starts_with":
			return `${subject} starts with ${value}`;
		case "ends_with":
			return `${subject} ends with ${value}`;
	}
}

export function describeAction(action: MailRuleAction, folderName: (id: string) => string | null): string {
	switch (action.kind) {
		case "mark_read":
			return "mark it read";
		case "flag":
			return "flag it";
		case "link_client":
			return "link its conversation to the client who sent it";
		case "trash":
			return "move it to Trash";
		case "archive":
			return "archive it";
		case "move": {
			const name = folderName(action.folderId);
			return name ? `move it to ${name}` : "move it to a folder that no longer exists";
		}
	}
}

function joinWords(parts: string[], joiner: "and" | "or"): string {
	if (parts.length <= 1) return parts[0] ?? "";
	return parts.join(` ${joiner} `);
}

/** One line for a list: the tests, then what happens. */
export function summariseRule(
	rule: Pick<MailRule, "match" | "conditions" | "actions">,
	folderName: (id: string) => string | null,
): string {
	const when = joinWords(rule.conditions.map(describeCondition), rule.match === "any" ? "or" : "and");
	const does = joinWords(
		orderedActions(rule.actions).map((action) => describeAction(action, folderName)),
		"and",
	);
	const sentence = `If ${when}, ${does}.`;
	return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The whole rule, as one paragraph a person can read before agreeing to it. */
export function describeRule(
	rule: Pick<MailRule, "name" | "enabled" | "match" | "conditions" | "actions" | "stopOnMatch">,
	context: { accountEmail: string; folderName: (id: string) => string | null },
): string {
	const when = joinWords(rule.conditions.map(describeCondition), rule.match === "any" ? "or" : "and");
	const does = joinWords(
		orderedActions(rule.actions).map((action) => describeAction(action, context.folderName)),
		"and",
	);
	const moves = rule.actions.some(isMovingAction);
	const rest = moves
		? "Once it has moved a message, the rules below it do not see that message."
		: rule.stopOnMatch
			? "A message it matches is not checked against the rules below it."
			: "A message it matches is still checked against the rules below it.";
	return [
		`Rule ${quote(rule.name)} for ${context.accountEmail}, ${rule.enabled ? "switched on" : "switched off"}.`,
		`When a new message arrives in the inbox${when ? `, if ${when}` : ""}, Juno will ${does}.`,
		rest,
		"It only looks at mail that arrives from now on, once per message, and it acts on the mail server as well as here.",
	].join(" ");
}
