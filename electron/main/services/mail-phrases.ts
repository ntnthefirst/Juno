/**
 * Greetings and sign-offs, and the rules that decide which goes where.
 *
 * The way Outlook does signatures, and nothing to do with templates. A phrase
 * is a named, static text: plain, several lines allowed, no placeholders. A
 * rule has conditions (what the message is, who it goes to, which account it
 * is sent from) and names the greeting and the sign-off it adds, either of
 * which may be none. Rules are checked top to bottom and the first enabled one
 * whose conditions all match decides. No match, nothing is added.
 *
 * Everything the composer, the settings window and an agent can do with them
 * is here once (decision 2). The adapters unwrap arguments and call these.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type {
	MailPhrase,
	MailPhraseInput,
	MailPhraseKind,
	MailPhraseMessageKind,
	MailPhraseMode,
	MailPhrasePatch,
	MailPhraseRecipientKind,
	MailPhraseResolution,
	MailPhraseResolveInput,
	MailPhraseRule,
	MailPhraseRuleInput,
	MailPhraseRulePatch,
	MailRecipientClass,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { mailAccounts, mailMessages, mailPhraseRules, mailPhrases } from "../db/schema";
import { clientMatches } from "./mail-recipients";

export type MailPhraseErrorCode =
	| "invalid"
	| "phrase-not-found"
	| "rule-not-found"
	| "account-not-found"
	| "in-use";

/** Written for a person, so both adapters can show `message` as it is. */
export class MailPhraseError extends Error {
	readonly code: MailPhraseErrorCode;
	constructor(code: MailPhraseErrorCode, message: string) {
		super(message);
		this.name = "MailPhraseError";
		this.code = code;
	}
}

const KINDS: MailPhraseKind[] = ["greeting", "signoff"];
const MESSAGE_KINDS: MailPhraseMessageKind[] = ["any", "new", "reply", "forward"];
const RECIPIENT_KINDS: MailPhraseRecipientKind[] = ["any", "client", "contact", "other"];

const MAX_TITLE = 100;
const MAX_TEXT = 2000;
const MAX_NAME = 100;

const KIND_LABEL: Record<MailPhraseKind, string> = { greeting: "greeting", signoff: "sign-off" };

type PhraseRow = typeof mailPhrases.$inferSelect;
type RuleRow = typeof mailPhraseRules.$inferSelect;

function toPhrase(row: PhraseRow): MailPhrase {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		kind: row.kind as MailPhraseKind,
		title: row.title,
		text: row.text,
		sortOrder: row.sortOrder,
	};
}

function toRule(row: RuleRow): MailPhraseRule {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		name: row.name,
		enabled: row.enabled,
		sortOrder: row.sortOrder,
		messageKind: row.messageKind as MailPhraseMessageKind,
		recipientKind: row.recipientKind as MailPhraseRecipientKind,
		accountId: row.accountId,
		greetingId: row.greetingId,
		signoffId: row.signoffId,
	};
}

/* ------------------------------------------------------------ validation */

function cleanTitle(value: string): string {
	const title = value.trim();
	if (!title) throw new MailPhraseError("invalid", "Give it a title.");
	if (title.length > MAX_TITLE) {
		throw new MailPhraseError("invalid", `The title can be at most ${MAX_TITLE} characters.`);
	}
	return title;
}

/** Line breaks are kept; the ends are trimmed and Windows line ends become plain ones. */
function cleanText(value: string): string {
	const text = value.replace(/\r\n?/g, "\n").trim();
	if (!text) throw new MailPhraseError("invalid", "Write the text.");
	if (text.length > MAX_TEXT) {
		throw new MailPhraseError("invalid", `The text can be at most ${MAX_TEXT} characters.`);
	}
	return text;
}

function cleanName(value: string): string {
	const name = value.trim();
	if (!name) throw new MailPhraseError("invalid", "Give the rule a name.");
	if (name.length > MAX_NAME) {
		throw new MailPhraseError("invalid", `The name can be at most ${MAX_NAME} characters.`);
	}
	return name;
}

function requireAccount(db: Db, id: string): void {
	const row = db
		.select({ id: mailAccounts.id })
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, id), isNull(mailAccounts.deletedAt)))
		.get();
	if (!row) {
		throw new MailPhraseError("account-not-found", "That mail account does not exist. Pick one from the list.");
	}
}

/** The phrase has to exist, be live, and be the kind the rule slot wants. */
function requirePhrase(db: Db, id: string, kind: MailPhraseKind): void {
	const row = db
		.select()
		.from(mailPhrases)
		.where(and(eq(mailPhrases.id, id), isNull(mailPhrases.deletedAt)))
		.get();
	if (!row) {
		throw new MailPhraseError(
			"phrase-not-found",
			`That ${KIND_LABEL[kind]} does not exist. Pick one from the list.`,
		);
	}
	if (row.kind !== kind) {
		throw new MailPhraseError(
			"invalid",
			`"${row.title}" is a ${KIND_LABEL[row.kind as MailPhraseKind]}, not a ${KIND_LABEL[kind]}. Pick a ${KIND_LABEL[kind]}.`,
		);
	}
}

function checkConditions(fields: {
	messageKind?: string | undefined;
	recipientKind?: string | undefined;
}): void {
	if (fields.messageKind !== undefined && !MESSAGE_KINDS.includes(fields.messageKind as MailPhraseMessageKind)) {
		throw new MailPhraseError("invalid", "The message has to be any, new, reply or forward.");
	}
	if (
		fields.recipientKind !== undefined &&
		!RECIPIENT_KINDS.includes(fields.recipientKind as MailPhraseRecipientKind)
	) {
		throw new MailPhraseError("invalid", "The recipient has to be any, client, contact or other.");
	}
}

/* -------------------------------------------------------------- phrases */

function nextOrder(values: number[]): number {
	return values.length === 0 ? 0 : Math.max(...values) + 1;
}

export async function listPhrases(kind?: MailPhraseKind, db: Db = getDb()): Promise<MailPhrase[]> {
	if (kind !== undefined && !KINDS.includes(kind)) {
		throw new MailPhraseError("invalid", "The kind has to be greeting or signoff.");
	}
	return db
		.select()
		.from(mailPhrases)
		.where(and(isNull(mailPhrases.deletedAt), kind ? eq(mailPhrases.kind, kind) : undefined))
		.orderBy(asc(mailPhrases.sortOrder), asc(mailPhrases.id))
		.all()
		.map(toPhrase);
}

export async function getPhrase(id: string, db: Db = getDb()): Promise<MailPhrase | null> {
	const row = db
		.select()
		.from(mailPhrases)
		.where(and(eq(mailPhrases.id, id), isNull(mailPhrases.deletedAt)))
		.get();
	return row ? toPhrase(row) : null;
}

function requirePhraseRow(db: Db, id: string): PhraseRow {
	const row = db
		.select()
		.from(mailPhrases)
		.where(and(eq(mailPhrases.id, id), isNull(mailPhrases.deletedAt)))
		.get();
	if (!row) throw new MailPhraseError("phrase-not-found", "That greeting or sign-off does not exist.");
	return row;
}

export async function createPhrase(input: MailPhraseInput, db: Db = getDb()): Promise<MailPhrase> {
	if (!KINDS.includes(input.kind)) {
		throw new MailPhraseError("invalid", "The kind has to be greeting or signoff.");
	}
	const title = cleanTitle(input.title);
	const text = cleanText(input.text);
	const stamp = now();
	const order = nextOrder(
		db
			.select({ sortOrder: mailPhrases.sortOrder })
			.from(mailPhrases)
			.where(and(isNull(mailPhrases.deletedAt), eq(mailPhrases.kind, input.kind)))
			.all()
			.map((row) => row.sortOrder),
	);
	const row = db
		.insert(mailPhrases)
		.values({ kind: input.kind, title, text, sortOrder: order, createdAt: stamp, updatedAt: stamp })
		.returning()
		.get();
	return toPhrase(row);
}

export async function updatePhrase(
	id: string,
	patch: MailPhrasePatch,
	db: Db = getDb(),
): Promise<MailPhrase> {
	requirePhraseRow(db, id);
	const row = db
		.update(mailPhrases)
		.set({
			...(patch.title !== undefined ? { title: cleanTitle(patch.title) } : {}),
			...(patch.text !== undefined ? { text: cleanText(patch.text) } : {}),
			updatedAt: now(),
		})
		.where(eq(mailPhrases.id, id))
		.returning()
		.get();
	return toPhrase(row);
}

/** "the rule A", "the rules A and B", "the rules A, B and C". */
function ruleNames(names: string[]): string {
	if (names.length === 1) return `the rule ${names[0]}`;
	return `the rules ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Soft delete. Refused while a live rule, enabled or not, still points at it,
 * because that rule would be left adding nothing without anyone having said so.
 */
export async function deletePhrase(id: string, db: Db = getDb()): Promise<MailPhrase> {
	requirePhraseRow(db, id);
	const users = db
		.select({ name: mailPhraseRules.name })
		.from(mailPhraseRules)
		.where(
			and(
				isNull(mailPhraseRules.deletedAt),
				or(eq(mailPhraseRules.greetingId, id), eq(mailPhraseRules.signoffId, id)),
			),
		)
		.orderBy(asc(mailPhraseRules.sortOrder), asc(mailPhraseRules.id))
		.all()
		.map((row) => row.name);
	if (users.length > 0) {
		throw new MailPhraseError(
			"in-use",
			`Used by ${ruleNames(users)}. Change ${users.length === 1 ? "that rule" : "those rules"} first.`,
		);
	}
	const stamp = now();
	const row = db
		.update(mailPhrases)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailPhrases.id, id))
		.returning()
		.get();
	return toPhrase(row);
}

/* ---------------------------------------------------------------- rules */

function liveRules(db: Db, onlyEnabled = false): RuleRow[] {
	return db
		.select()
		.from(mailPhraseRules)
		.where(and(isNull(mailPhraseRules.deletedAt), onlyEnabled ? eq(mailPhraseRules.enabled, true) : undefined))
		.orderBy(asc(mailPhraseRules.sortOrder), asc(mailPhraseRules.id))
		.all();
}

function requireRuleRow(db: Db, id: string): RuleRow {
	const row = db
		.select()
		.from(mailPhraseRules)
		.where(and(eq(mailPhraseRules.id, id), isNull(mailPhraseRules.deletedAt)))
		.get();
	if (!row) throw new MailPhraseError("rule-not-found", "That rule does not exist.");
	return row;
}

export async function listRules(db: Db = getDb()): Promise<MailPhraseRule[]> {
	return liveRules(db).map(toRule);
}

export async function getRule(id: string, db: Db = getDb()): Promise<MailPhraseRule | null> {
	const row = db
		.select()
		.from(mailPhraseRules)
		.where(and(eq(mailPhraseRules.id, id), isNull(mailPhraseRules.deletedAt)))
		.get();
	return row ? toRule(row) : null;
}

export async function createRule(input: MailPhraseRuleInput, db: Db = getDb()): Promise<MailPhraseRule> {
	const name = cleanName(input.name);
	checkConditions(input);
	if (input.accountId) requireAccount(db, input.accountId);
	if (input.greetingId) requirePhrase(db, input.greetingId, "greeting");
	if (input.signoffId) requirePhrase(db, input.signoffId, "signoff");
	const stamp = now();
	const row = db
		.insert(mailPhraseRules)
		.values({
			name,
			enabled: input.enabled ?? true,
			sortOrder: nextOrder(liveRules(db).map((rule) => rule.sortOrder)),
			messageKind: input.messageKind ?? "any",
			recipientKind: input.recipientKind ?? "any",
			accountId: input.accountId || null,
			greetingId: input.greetingId || null,
			signoffId: input.signoffId || null,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get();
	return toRule(row);
}

export async function updateRule(
	id: string,
	patch: MailPhraseRulePatch,
	db: Db = getDb(),
): Promise<MailPhraseRule> {
	const current = requireRuleRow(db, id);
	checkConditions(patch);
	// A rule keeps working with an account that was removed afterwards; only a
	// change to a different account has to name one that exists.
	if (patch.accountId && patch.accountId !== current.accountId) requireAccount(db, patch.accountId);
	if (patch.greetingId && patch.greetingId !== current.greetingId) {
		requirePhrase(db, patch.greetingId, "greeting");
	}
	if (patch.signoffId && patch.signoffId !== current.signoffId) {
		requirePhrase(db, patch.signoffId, "signoff");
	}
	const row = db
		.update(mailPhraseRules)
		.set({
			...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			...(patch.messageKind !== undefined ? { messageKind: patch.messageKind } : {}),
			...(patch.recipientKind !== undefined ? { recipientKind: patch.recipientKind } : {}),
			...(patch.accountId !== undefined ? { accountId: patch.accountId || null } : {}),
			...(patch.greetingId !== undefined ? { greetingId: patch.greetingId || null } : {}),
			...(patch.signoffId !== undefined ? { signoffId: patch.signoffId || null } : {}),
			updatedAt: now(),
		})
		.where(eq(mailPhraseRules.id, id))
		.returning()
		.get();
	return toRule(row);
}

export async function deleteRule(id: string, db: Db = getDb()): Promise<MailPhraseRule> {
	requireRuleRow(db, id);
	const stamp = now();
	const row = db
		.update(mailPhraseRules)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailPhraseRules.id, id))
		.returning()
		.get();
	return toRule(row);
}

/**
 * Sets the order from the list given, which has to be every live rule exactly
 * once. A partial list would leave the rest with numbers that collide with the
 * new ones, and "first match wins" would then depend on ties.
 */
export async function reorderRules(ids: string[], db: Db = getDb()): Promise<MailPhraseRule[]> {
	const live = liveRules(db);
	const known = new Set(live.map((rule) => rule.id));
	if (new Set(ids).size !== ids.length) {
		throw new MailPhraseError("invalid", "A rule appears twice in the new order.");
	}
	const unknown = ids.find((id) => !known.has(id));
	if (unknown !== undefined) {
		throw new MailPhraseError("rule-not-found", "One of those rules does not exist any more. Reload the list.");
	}
	if (ids.length !== live.length) {
		throw new MailPhraseError("invalid", "The new order has to list every rule once.");
	}
	const stamp = now();
	db.transaction((tx) => {
		ids.forEach((id, index) => {
			tx.update(mailPhraseRules)
				.set({ sortOrder: index, updatedAt: stamp })
				.where(eq(mailPhraseRules.id, id))
				.run();
		});
	});
	return liveRules(db).map(toRule);
}

/* -------------------------------------------------------------- resolve */

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

/**
 * What the recipients of a message are, for a rule's "who it goes to".
 *
 * - client: any address belongs to a client, by the client's own addresses or
 *   by one of its contacts (the notion `clientsFor` already uses).
 * - contact: not a client, but known here: the address has written to one of
 *   the mailboxes, so it appears as the sender of synced mail. Mail Juno only
 *   sent to it does not count, because that is not yet a relationship.
 * - other: anyone else.
 *
 * With several recipients the strongest wins: client over contact over other,
 * so a message to a client and a stranger still reads as a client message.
 * An empty list is null, which only a rule that does not care can match; a new
 * message starts that way, and the composer asks again once there is an address.
 */
export async function classifyRecipients(
	addresses: string[],
	db: Db = getDb(),
): Promise<MailRecipientClass | null> {
	const wanted = unique(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean));
	if (wanted.length === 0) return null;
	if (clientMatches(db, wanted).size > 0) return "client";
	const known = db
		.select({ id: mailMessages.id })
		.from(mailMessages)
		.where(
			and(
				isNull(mailMessages.deletedAt),
				inArray(sql`lower(${mailMessages.fromAddress})`, wanted),
			),
		)
		.limit(1)
		.get();
	return known ? "contact" : "other";
}

function matches(
	rule: RuleRow,
	input: { accountId: string; mode: MailPhraseMode; recipients: MailRecipientClass | null },
): boolean {
	if (rule.messageKind !== "any" && rule.messageKind !== input.mode) return false;
	if (rule.accountId !== null && rule.accountId !== input.accountId) return false;
	if (rule.recipientKind !== "any" && rule.recipientKind !== input.recipients) return false;
	return true;
}

function textOf(db: Db, id: string | null): string | null {
	if (!id) return null;
	const row = db
		.select({ text: mailPhrases.text })
		.from(mailPhrases)
		.where(and(eq(mailPhrases.id, id), isNull(mailPhrases.deletedAt)))
		.get();
	return row ? row.text : null;
}

/** The first enabled rule that matches, and the two texts it adds. Read-only. */
export async function resolve(
	input: MailPhraseResolveInput,
	db: Db = getDb(),
): Promise<MailPhraseResolution> {
	if (!["new", "reply", "forward"].includes(input.mode)) {
		throw new MailPhraseError("invalid", "The mode has to be new, reply or forward.");
	}
	const rules = liveRules(db, true);
	if (rules.length === 0) return { ruleId: null, greeting: null, signoff: null };
	const recipients = await classifyRecipients(
		input.to.map((entry) => entry.address),
		db,
	);
	const rule = rules.find((candidate) =>
		matches(candidate, { accountId: input.accountId, mode: input.mode, recipients }),
	);
	if (!rule) return { ruleId: null, greeting: null, signoff: null };
	return {
		ruleId: rule.id,
		greeting: textOf(db, rule.greetingId),
		signoff: textOf(db, rule.signoffId),
	};
}
