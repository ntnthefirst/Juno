/**
 * Mailbox rules: what the owner told one mailbox to do with new mail.
 *
 * A rule has tests on a message and things to do with the ones that pass, and a
 * mailbox keeps an ordered list of them, checked from the top. After the inbox
 * of an account has been pulled, the sync hands this module the account, and
 * every message that arrived since the account was connected and that no rule
 * has looked at before is tested, and filed accordingly (decision 64).
 *
 * **This is the one place Juno files mail without a person pressing a button**,
 * and it is allowed for one reason: a rule the owner wrote and switched on is the
 * owner's standing instruction. Everything that makes that narrow is here:
 *
 * - an agent can only ask for a rule through the approval gate (`review*` build
 *   what the owner reads first), and no automation can touch one;
 * - a message is looked at once, ever. The record of that is keyed by
 *   Message-ID, so a restart, a re-sync and a UIDVALIDITY change cannot make an
 *   old message new, and an account's first sync cannot file years of mail
 *   because mail older than the moment the account was connected is history;
 * - filing goes through `mail-actions.ts`, server first and local second, so
 *   the two cannot disagree;
 * - a failed action is written down and never tried again;
 * - every action writes a history row naming the rule;
 * - nothing here compiles a pattern or runs text from a message or a rule: a
 *   condition is data (`shared/mail-rules.ts`).
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, max, notExists, sql } from "drizzle-orm";
import {
	MAIL_RULE_ACTION_KINDS,
	MAIL_RULE_TEXT_FIELDS,
	MAIL_RULE_TEXT_TESTS,
	MAX_RULE_CONDITIONS,
	MAX_RULE_NAME,
	MAX_RULE_VALUE,
	MAX_RULES_PER_ACCOUNT,
	describeRule,
	foldForMatch,
	isMovingAction,
	ruleMatches,
	type MailRuleFacts,
} from "../../shared/mail-rules";
import type {
	MailAddress,
	MailRule,
	MailRuleAction,
	MailRuleActionKind,
	MailRuleCondition,
	MailRuleInput,
	MailRuleMatch,
	MailRulePass,
	MailRulePatch,
	MailRuleResult,
	MailRuleRun,
	MailRuleRunQuery,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { LOCAL_OWNER_ID, now } from "../db/columns";
import {
	mailAccounts,
	mailFolders,
	mailMessages,
	mailRuleRuns,
	mailRules,
	mailRuleSeen,
	mailThreads,
} from "../db/schema";
import * as filing from "./mail-actions";
import { clientMatches } from "./mail-recipients";
import { ensureRulesSince } from "./mail-store";
import * as threads from "./mail-threads";

export type MailRuleErrorCode = "invalid" | "not-found";

/** Written for a person, so the window and an agent can both show `message` as it is. */
export class MailRuleError extends Error {
	readonly code: MailRuleErrorCode;
	constructor(code: MailRuleErrorCode, message: string) {
		super(message);
		this.name = "MailRuleError";
		this.code = code;
	}
}

type Row = typeof mailRules.$inferSelect;
type RunRow = typeof mailRuleRuns.$inferSelect;
type MessageRow = typeof mailMessages.$inferSelect;

/** Messages looked at in one pass. The rest are still unseen and come with the next sync. */
const MAX_PER_PASS = 500;
/** Consecutive failures after which a batch stops trying message by message. */
const GIVE_UP_AFTER = 3;
const MAX_ERROR = 300;
const MAX_SUBJECT = 200;
const MAX_ADDRESS = 320;

/* ------------------------------------------------------------------ shape */

function parseArray(json: string): unknown[] {
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

function toRule(row: Row): MailRule {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		accountId: row.accountId,
		name: row.name,
		enabled: row.enabled,
		match: row.matchMode === "any" ? "any" : "all",
		// Read back through the same check as a write: a row edited by hand into
		// something that is not a condition simply has no conditions, and a rule
		// with none matches nothing.
		conditions: parseArray(row.conditionsJson).flatMap((entry) => {
			const clean = tryCondition(entry);
			return clean ? [clean] : [];
		}),
		actions: parseArray(row.actionsJson).flatMap((entry) => {
			const clean = tryAction(entry);
			return clean ? [clean] : [];
		}),
		stopOnMatch: row.stopOnMatch,
		sortOrder: row.sortOrder,
	};
}

function toRun(row: RunRow): MailRuleRun {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		accountId: row.accountId,
		ruleId: row.ruleId,
		ruleName: row.ruleName,
		messageId: row.messageId,
		subject: row.subject,
		fromAddress: row.fromAddress,
		action: row.action as MailRuleActionKind,
		detail: row.detail,
		result: row.result as MailRuleResult,
		error: row.error,
	};
}

/* ------------------------------------------------------------ validation */

/** True when a text holds a control character: a line break, a tab, an escape. */
function hasControl(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) < 32) return true;
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryCondition(value: unknown): MailRuleCondition | null {
	try {
		return cleanCondition(value);
	} catch {
		return null;
	}
}

function tryAction(value: unknown): MailRuleAction | null {
	try {
		return cleanAction(value);
	} catch {
		return null;
	}
}

/** Builds a fresh object, so nothing an input carried beyond the known fields is kept. */
function cleanCondition(value: unknown): MailRuleCondition {
	if (!isRecord(value)) throw new MailRuleError("invalid", "A condition has to be an object.");
	if (value.kind === "sender_is_client" || value.kind === "has_attachments") {
		if (typeof value.value !== "boolean") {
			throw new MailRuleError("invalid", `The ${value.kind} condition needs true or false.`);
		}
		return { kind: value.kind, value: value.value };
	}
	if (value.kind !== "text") {
		throw new MailRuleError(
			"invalid",
			`"${String(value.kind)}" is not a condition. Use text, sender_is_client or has_attachments.`,
		);
	}
	const field = String(value.field);
	const test = String(value.test);
	if (!MAIL_RULE_TEXT_FIELDS.includes(field as never)) {
		throw new MailRuleError("invalid", `"${field}" is not something to test. Use ${MAIL_RULE_TEXT_FIELDS.join(", ")}.`);
	}
	if (!MAIL_RULE_TEXT_TESTS.includes(test as never)) {
		throw new MailRuleError("invalid", `"${test}" is not a test. Use ${MAIL_RULE_TEXT_TESTS.join(", ")}.`);
	}
	if (typeof value.value !== "string") throw new MailRuleError("invalid", "A text condition needs the text to look for.");
	const text = value.value.trim();
	if (hasControl(text)) {
		throw new MailRuleError("invalid", "The text to look for has to be on one line.");
	}
	if (foldForMatch(text).trim() === "") throw new MailRuleError("invalid", "Write the text to look for.");
	if (text.length > MAX_RULE_VALUE) {
		throw new MailRuleError("invalid", `The text to look for can be at most ${MAX_RULE_VALUE} characters.`);
	}
	return { kind: "text", field, test, value: text } as MailRuleCondition;
}

function cleanAction(value: unknown): MailRuleAction {
	if (!isRecord(value)) throw new MailRuleError("invalid", "An action has to be an object.");
	const kind = String(value.kind);
	if (!MAIL_RULE_ACTION_KINDS.includes(kind as MailRuleActionKind)) {
		throw new MailRuleError("invalid", `"${kind}" is not an action. Use ${MAIL_RULE_ACTION_KINDS.join(", ")}.`);
	}
	if (kind === "move") {
		if (typeof value.folderId !== "string" || value.folderId === "") {
			throw new MailRuleError("invalid", "Moving a message needs a folder.");
		}
		return { kind: "move", folderId: value.folderId };
	}
	return { kind } as MailRuleAction;
}

function requireAccount(accountId: string, db: Db): { id: string; email: string } {
	const account = db
		.select({ id: mailAccounts.id, email: mailAccounts.email })
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, accountId), isNull(mailAccounts.deletedAt)))
		.get();
	if (!account) throw new MailRuleError("not-found", "That mail account does not exist.");
	return account;
}

function folderOf(folderId: string, db: Db) {
	return db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.id, folderId), isNull(mailFolders.deletedAt)))
		.get();
}

interface Clean {
	name: string;
	enabled: boolean;
	match: MailRuleMatch;
	conditions: MailRuleCondition[];
	actions: MailRuleAction[];
	stopOnMatch: boolean;
}

function cleanName(value: unknown): string {
	const name = typeof value === "string" ? value.trim() : "";
	if (!name) throw new MailRuleError("invalid", "Give the rule a name.");
	if (name.length > MAX_RULE_NAME) {
		throw new MailRuleError("invalid", `The name can be at most ${MAX_RULE_NAME} characters.`);
	}
	if (hasControl(name)) throw new MailRuleError("invalid", "The name has to be on one line.");
	return name;
}

function cleanMatch(value: unknown): MailRuleMatch {
	if (value !== "all" && value !== "any") {
		throw new MailRuleError("invalid", `"${String(value)}" is not a way to match. Use all or any.`);
	}
	return value;
}

/** Everything a rule must satisfy to be stored, checked against the account it belongs to. */
function cleanRule(accountId: string, input: Clean, db: Db): Clean {
	const name = cleanName(input.name);
	const match = cleanMatch(input.match);
	if (!Array.isArray(input.conditions) || input.conditions.length === 0) {
		throw new MailRuleError("invalid", "A rule needs at least one condition, so it never acts on every message by accident.");
	}
	if (input.conditions.length > MAX_RULE_CONDITIONS) {
		throw new MailRuleError("invalid", `A rule can have at most ${MAX_RULE_CONDITIONS} conditions.`);
	}
	const conditions = input.conditions.map(cleanCondition);

	if (!Array.isArray(input.actions) || input.actions.length === 0) {
		throw new MailRuleError("invalid", "A rule needs at least one action.");
	}
	const actions = input.actions.map(cleanAction);
	const kinds = actions.map((action) => action.kind);
	if (new Set(kinds).size !== kinds.length) {
		throw new MailRuleError("invalid", "An action can only be in a rule once.");
	}
	if (actions.filter(isMovingAction).length > 1) {
		throw new MailRuleError("invalid", "A rule can put a message in one place only: move it, trash it or archive it.");
	}
	for (const action of actions) {
		if (action.kind !== "move") continue;
		const folder = folderOf(action.folderId, db);
		if (!folder || folder.accountId !== accountId) {
			throw new MailRuleError("invalid", "That folder is not one of this account's folders.");
		}
		if (folder.specialUse === "inbox") {
			throw new MailRuleError("invalid", "Mail already arrives in the inbox. Pick another folder.");
		}
	}
	return {
		name,
		enabled: input.enabled === true,
		match,
		conditions,
		actions,
		stopOnMatch: input.stopOnMatch === true,
	};
}

/* ------------------------------------------------------------------ reads */

function alive(accountId: string) {
	return and(eq(mailRules.accountId, accountId), eq(mailRules.ownerId, LOCAL_OWNER_ID), isNull(mailRules.deletedAt));
}

/** The rules of one mailbox in the order they are checked. */
export function list(accountId: string, db: Db = getDb()): MailRule[] {
	return db
		.select()
		.from(mailRules)
		.where(alive(accountId))
		.orderBy(asc(mailRules.sortOrder), asc(mailRules.id))
		.all()
		.map(toRule);
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(mailRules)
		.where(and(eq(mailRules.id, id), isNull(mailRules.deletedAt)))
		.get();
	if (!row) throw new MailRuleError("not-found", "That rule does not exist.");
	return row;
}

export function get(id: string, db: Db = getDb()): MailRule {
	return toRule(requireRow(id, db));
}

/** What a rule did, newest first. */
export function runs(query: MailRuleRunQuery, db: Db = getDb()): MailRuleRun[] {
	const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
	return db
		.select()
		.from(mailRuleRuns)
		.where(
			and(
				eq(mailRuleRuns.accountId, query.accountId),
				isNull(mailRuleRuns.deletedAt),
				...(query.ruleId ? [eq(mailRuleRuns.ruleId, query.ruleId)] : []),
			),
		)
		.orderBy(desc(mailRuleRuns.createdAt), desc(mailRuleRuns.id))
		.limit(limit)
		.all()
		.map(toRun);
}

/* ----------------------------------------------------------------- writes */

export function create(input: MailRuleInput, db: Db = getDb()): MailRule {
	requireAccount(input.accountId, db);
	const clean = cleanRule(
		input.accountId,
		{
			name: input.name,
			enabled: input.enabled ?? true,
			match: input.match ?? "all",
			conditions: input.conditions,
			actions: input.actions,
			stopOnMatch: input.stopOnMatch ?? false,
		},
		db,
	);
	const existing = list(input.accountId, db);
	if (existing.length >= MAX_RULES_PER_ACCOUNT) {
		throw new MailRuleError("invalid", `A mailbox can have at most ${MAX_RULES_PER_ACCOUNT} rules.`);
	}
	const last = db.select({ value: max(mailRules.sortOrder) }).from(mailRules).where(alive(input.accountId)).get();
	const stamp = now();
	const [row] = db
		.insert(mailRules)
		.values({
			ownerId: LOCAL_OWNER_ID,
			accountId: input.accountId,
			name: clean.name,
			enabled: clean.enabled,
			matchMode: clean.match,
			conditionsJson: JSON.stringify(clean.conditions),
			actionsJson: JSON.stringify(clean.actions),
			stopOnMatch: clean.stopOnMatch,
			sortOrder: (last?.value ?? -1) + 1,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.all();
	return toRule(row!);
}

/** The rule as it would be after a patch, checked. Nothing is written. */
function patched(existing: MailRule, patch: MailRulePatch, db: Db): Clean {
	return cleanRule(
		existing.accountId,
		{
			name: patch.name ?? existing.name,
			enabled: patch.enabled ?? existing.enabled,
			match: patch.match ?? existing.match,
			conditions: patch.conditions ?? existing.conditions,
			actions: patch.actions ?? existing.actions,
			stopOnMatch: patch.stopOnMatch ?? existing.stopOnMatch,
		},
		db,
	);
}

export function update(id: string, patch: MailRulePatch, db: Db = getDb()): MailRule {
	const existing = get(id, db);
	const clean = patched(existing, patch, db);
	const [row] = db
		.update(mailRules)
		.set({
			name: clean.name,
			enabled: clean.enabled,
			matchMode: clean.match,
			conditionsJson: JSON.stringify(clean.conditions),
			actionsJson: JSON.stringify(clean.actions),
			stopOnMatch: clean.stopOnMatch,
			updatedAt: now(),
		})
		.where(eq(mailRules.id, id))
		.returning()
		.all();
	return toRule(row!);
}

/** Soft delete. Its history stays, under the name it had. */
export function remove(id: string, db: Db = getDb()): MailRule {
	requireRow(id, db);
	const stamp = now();
	const [row] = db
		.update(mailRules)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailRules.id, id))
		.returning()
		.all();
	return toRule(row!);
}

/**
 * Sets the order a mailbox's rules are checked in. The ids have to be exactly the
 * live rules of that mailbox, each once, so a list that was out of date cannot
 * drop one.
 */
export function reorder(accountId: string, ids: string[], db: Db = getDb()): MailRule[] {
	const current = list(accountId, db);
	const same =
		ids.length === current.length &&
		new Set(ids).size === ids.length &&
		current.every((rule) => ids.includes(rule.id));
	if (!same) {
		throw new MailRuleError("invalid", "Pass every rule of this mailbox once. The list has changed, so reload it and try again.");
	}
	const stamp = now();
	db.transaction((tx) => {
		ids.forEach((id, index) => {
			tx.update(mailRules).set({ sortOrder: index, updatedAt: stamp }).where(eq(mailRules.id, id)).run();
		});
	});
	return list(accountId, db);
}

/* ------------------------------------------------- what the owner reads */

function folderNamer(db: Db): (id: string) => string | null {
	return (id) => folderOf(id, db)?.name ?? null;
}

/** The whole rule in plain words, for the list and for an approval. */
export function describe(rule: MailRule, db: Db = getDb()): string {
	const account = db.select({ email: mailAccounts.email }).from(mailAccounts).where(eq(mailAccounts.id, rule.accountId)).get();
	return describeRule(rule, { accountEmail: account?.email ?? "this mailbox", folderName: folderNamer(db) });
}

/** The same, for a rule that is stored. */
export function explain(id: string, db: Db = getDb()): string {
	return describe(get(id, db), db);
}

export interface RuleReview {
	summary: string;
	preview: string;
	seal: string;
}

function sealOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function review(summary: string, preview: string): RuleReview {
	return { summary, preview, seal: sealOf(preview) };
}

const RULE_REVIEW_NOTE =
	"This is a standing instruction. Once it is approved and switched on, Juno carries it out on its own for every new message, on the mail server as well as here.";

function ruleFromClean(accountId: string, id: string, clean: Clean): MailRule {
	return { id, ownerId: LOCAL_OWNER_ID, createdAt: "", updatedAt: "", deletedAt: null, accountId, sortOrder: 0, ...clean };
}

/** What a person reads before an agent's new rule is made. Refuses a rule that could not be stored. */
export function reviewCreate(input: MailRuleInput, db: Db = getDb()): RuleReview {
	const account = requireAccount(input.accountId, db);
	const clean = cleanRule(
		input.accountId,
		{
			name: input.name,
			enabled: input.enabled ?? true,
			match: input.match ?? "all",
			conditions: input.conditions,
			actions: input.actions,
			stopOnMatch: input.stopOnMatch ?? false,
		},
		db,
	);
	const text = describeRule(clean, { accountEmail: account.email, folderName: folderNamer(db) });
	return review(`Add the rule "${clean.name}" to ${account.email}`, `New rule. ${text}\n\n${RULE_REVIEW_NOTE}`);
}

export function reviewUpdate(id: string, patch: MailRulePatch, db: Db = getDb()): RuleReview {
	const existing = get(id, db);
	const clean = patched(existing, patch, db);
	const before = describe(existing, db);
	const account = requireAccount(existing.accountId, db);
	const after = describeRule(ruleFromClean(existing.accountId, id, clean), {
		accountEmail: account.email,
		folderName: folderNamer(db),
	});
	// The rule's own timestamp is in the seal, so a change made by hand between
	// the request and the approval is not approved by accident.
	const preview = `Change to a rule.\n\nNow: ${before}\n\nAfter: ${after}\n\n${RULE_REVIEW_NOTE}`;
	return {
		summary: `Change the rule "${existing.name}" on ${account.email}`,
		preview,
		seal: sealOf(`${preview}\n${get(id, db).updatedAt}`),
	};
}

export function reviewRemove(id: string, db: Db = getDb()): RuleReview {
	const existing = get(id, db);
	const account = requireAccount(existing.accountId, db);
	const preview = `Remove a rule. Its history stays.\n\n${describe(existing, db)}`;
	return {
		summary: `Remove the rule "${existing.name}" from ${account.email}`,
		preview,
		seal: sealOf(`${preview}\n${existing.updatedAt}`),
	};
}

export function reviewReorder(accountId: string, ids: string[], db: Db = getDb()): RuleReview {
	const account = requireAccount(accountId, db);
	const current = list(accountId, db);
	const byId = new Map(current.map((rule) => [rule.id, rule]));
	const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => byId.has(id));
	if (!same) {
		throw new MailRuleError("invalid", "Pass every rule of this mailbox once. Read the list again and try again.");
	}
	const lines = ids.map((id, index) => `${index + 1}. ${byId.get(id)!.name}`);
	const preview = `New order for the rules of ${account.email}. They are checked from the top.\n\n${lines.join("\n")}`;
	return {
		summary: `Reorder the rules of ${account.email}`,
		preview,
		seal: sealOf(`${preview}\n${current.map((rule) => rule.updatedAt).join(",")}`),
	};
}

/** Refuses an approval whose rule, or whose rules, are no longer what the owner read. */
export function verifySeal(expected: RuleReview, seal: string | null): void {
	if (seal === null || seal !== expected.seal) {
		throw new MailRuleError("invalid", "The rule changed after it was asked for, so what was approved is not what would happen. Ask again.");
	}
}

/* --------------------------------------------------------------- the pass */

function keyOf(message: MessageRow): string {
	const id = message.messageId?.trim().toLowerCase();
	if (id) return id;
	// A message with no Message-ID is identified by what it says and when it
	// arrived, which is as close to one as it gets.
	return (
		"h:" +
		createHash("sha256")
			.update([message.fromAddress ?? "", message.subject, message.internalDate, String(message.size ?? "")].join("\n"))
			.digest("hex")
	);
}

function addressesOf(json: string): string[] {
	return parseArray(json).flatMap((entry) => {
		if (!isRecord(entry) || typeof entry.address !== "string") return [];
		const address = (entry as unknown as MailAddress).address.trim();
		return address ? [address.slice(0, MAX_ADDRESS)] : [];
	});
}

function cut(text: string | null, length: number): string {
	return Array.from(text ?? "", (char) => (hasControl(char) ? " " : char)).join("").slice(0, length);
}

interface Planned {
	rule: MailRule;
	message: MessageRow;
	action: MailRuleAction;
	detail: string | null;
}

export interface PassOptions {
	/** True while the app is locked. Nothing starts, and what has not started is left for later. */
	isPaused?: () => boolean;
}

/** Messages in the inbox that arrived since the account was connected and that no rule has seen. */
function unseenInbox(db: Db, accountId: string, inboxId: string, since: string): MessageRow[] {
	const rows = db
		.select()
		.from(mailMessages)
		.where(
			and(
				eq(mailMessages.accountId, accountId),
				eq(mailMessages.folderId, inboxId),
				isNull(mailMessages.deletedAt),
				gte(mailMessages.internalDate, since),
				// An index lookup per message, so a mailbox that has been connected for
				// years does not hand back every message it has ever had on each pass.
				// It is a narrowing only: the exact key is checked again below.
				notExists(
					db
						.select({ one: sql`1` })
						.from(mailRuleSeen)
						.where(
							and(
								eq(mailRuleSeen.accountId, accountId),
								eq(mailRuleSeen.messageKey, sql`lower(trim(${mailMessages.messageId}))`),
							),
						),
				),
			),
		)
		.orderBy(asc(mailMessages.internalDate), asc(mailMessages.id))
		.limit(MAX_PER_PASS)
		.all();
	if (rows.length === 0) return rows;

	const keys = rows.map(keyOf);
	const seen = new Set<string>();
	for (let i = 0; i < keys.length; i += 400) {
		for (const row of db
			.select({ key: mailRuleSeen.messageKey })
			.from(mailRuleSeen)
			.where(and(eq(mailRuleSeen.accountId, accountId), inArray(mailRuleSeen.messageKey, keys.slice(i, i + 400))))
			.all()) {
			seen.add(row.key);
		}
	}
	return rows.filter((_, index) => !seen.has(keys[index]!));
}

function markSeen(db: Db, accountId: string, messages: MessageRow[]): void {
	if (messages.length === 0) return;
	const stamp = now();
	db.transaction((tx) => {
		for (const message of messages) {
			tx.insert(mailRuleSeen)
				.values({ ownerId: LOCAL_OWNER_ID, accountId, messageKey: keyOf(message), createdAt: stamp, updatedAt: stamp })
				.onConflictDoNothing()
				.run();
		}
	});
}

function record(
	db: Db,
	entry: Planned,
	result: MailRuleResult,
	error: string | null,
	detail: string | null = entry.detail,
): MailRuleResult {
	const stamp = now();
	db.insert(mailRuleRuns)
		.values({
			ownerId: LOCAL_OWNER_ID,
			accountId: entry.message.accountId,
			ruleId: entry.rule.id,
			ruleName: entry.rule.name,
			messageId: entry.message.id,
			subject: cut(entry.message.subject, MAX_SUBJECT),
			fromAddress: entry.message.fromAddress ? cut(entry.message.fromAddress, MAX_ADDRESS) : null,
			action: entry.action.kind,
			detail,
			result,
			error: error ? cut(error, MAX_ERROR) : null,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.run();
	return result;
}

function messageOf(cause: unknown): string {
	return cause instanceof Error && cause.message ? cause.message : "The server did not accept it.";
}

/**
 * Carries out one action for a group of messages. The group goes as one call,
 * because a call opens a connection and a mailbox with a burst of new mail would
 * otherwise open one per message. When the call fails it is tried again one
 * message at a time, so one bad message does not take the others down with it,
 * and gives up after a few failures in a row, so a server that is simply down is
 * not asked a hundred times. Nothing is tried again on a later pass.
 */
async function carryOut(
	db: Db,
	entries: Planned[],
	isPaused: () => boolean,
	call: (messageIds: string[]) => Promise<string | null | void>,
	tally: MailRulePass,
): Promise<void> {
	if (entries.length === 0) return;
	const count = (result: MailRuleResult) => {
		tally[result] += 1;
	};

	if (isPaused()) {
		for (const entry of entries) count(record(db, entry, "skipped", "Juno was locked before this could run."));
		return;
	}
	try {
		const detail = await call(entries.map((entry) => entry.message.id));
		for (const entry of entries) count(record(db, entry, "done", null, detail ?? entry.detail));
		return;
	} catch (cause) {
		if (entries.length === 1) {
			count(record(db, entries[0]!, "failed", messageOf(cause)));
			return;
		}
	}

	let failures = 0;
	let lastError = "";
	for (const entry of entries) {
		if (failures >= GIVE_UP_AFTER) {
			count(record(db, entry, "failed", `Not tried: ${lastError}`));
			continue;
		}
		if (isPaused()) {
			count(record(db, entry, "skipped", "Juno was locked before this could run."));
			continue;
		}
		try {
			const detail = await call([entry.message.id]);
			failures = 0;
			count(record(db, entry, "done", null, detail ?? entry.detail));
		} catch (cause) {
			failures += 1;
			lastError = messageOf(cause);
			count(record(db, entry, "failed", lastError));
		}
	}
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = groups.get(k);
		if (list) list.push(item);
		else groups.set(k, [item]);
	}
	return [...groups.values()];
}

/** Marks and flags that would change nothing are not sent to the server. */
function alreadyDone(entry: Planned): boolean {
	if (entry.action.kind === "mark_read") return entry.message.isSeen;
	if (entry.action.kind === "flag") return entry.message.isFlagged;
	return false;
}

async function linkToClient(db: Db, entry: Planned): Promise<MailRuleResult> {
	const thread = db.select().from(mailThreads).where(eq(mailThreads.id, entry.message.threadId)).get();
	if (!thread || thread.deletedAt) return record(db, entry, "skipped", "The conversation is gone.");
	if (thread.linkSource === "manual") {
		return record(db, entry, "skipped", "A person already chose this conversation's client.");
	}
	const address = entry.message.fromAddress;
	const found = address ? [...(clientMatches(db, [address]).values())].flat() : [];
	const ids = [...new Set(found.map((match) => match.clientId))];
	if (ids.length === 0) return record(db, entry, "skipped", "No client has the sender's address.");
	if (ids.length > 1) return record(db, entry, "skipped", "More than one client has the sender's address.");
	if (thread.clientId === ids[0]) return record(db, entry, "skipped", "Already linked to this client.");
	try {
		await threads.linkClient(entry.message.threadId, ids[0]!, db);
		return record(db, entry, "done", null, found[0]?.clientName ?? null);
	} catch (cause) {
		return record(db, entry, "failed", messageOf(cause));
	}
}

/**
 * Tests the new mail of an account against its rules and files what matches.
 *
 * Called by the sync after the inbox has been pulled. A pass looks at messages in
 * the inbox that arrived since the account was connected and that nothing has
 * looked at, marks every one of them as looked at before anything is done to
 * any (so a failure, a crash or a lock cannot make a message come round again),
 * and then carries out what the rules ask, in this order: mark read, flag, link
 * to the client, and only then the move, because a moved message is no longer
 * where the earlier actions found it.
 *
 * A message that a rule moves is not offered to the rules below that rule.
 */
export async function runForAccount(
	accountId: string,
	db: Db = getDb(),
	options: PassOptions = {},
): Promise<MailRulePass> {
	const isPaused = options.isPaused ?? (() => false);
	const tally: MailRulePass = { checked: 0, matched: 0, done: 0, skipped: 0, failed: 0 };
	if (isPaused()) return tally;

	const since = ensureRulesSince(db, accountId);
	const inbox = db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), eq(mailFolders.specialUse, "inbox"), isNull(mailFolders.deletedAt)))
		.get();
	if (!inbox) return tally;

	const candidates = unseenInbox(db, accountId, inbox.id, since);
	tally.checked = candidates.length;
	if (candidates.length === 0) return tally;

	const rules = list(accountId, db).filter((rule) => rule.enabled);
	if (rules.length === 0) {
		markSeen(db, accountId, candidates);
		return tally;
	}

	const clientsBySender = clientMatches(
		db,
		candidates.flatMap((message) => (message.fromAddress ? [message.fromAddress] : [])),
	);
	const folderName = folderNamer(db);

	const plan: Planned[] = [];
	for (const message of candidates) {
		const facts: MailRuleFacts = {
			senderAddress: message.fromAddress ?? "",
			recipientAddresses: [...addressesOf(message.toJson), ...addressesOf(message.ccJson)],
			subject: message.subject,
			senderIsClient: message.fromAddress ? (clientsBySender.get(message.fromAddress.trim().toLowerCase())?.length ?? 0) > 0 : false,
			hasAttachments: message.hasAttachments,
		};
		let matched = false;
		for (const rule of rules) {
			if (!ruleMatches(rule, facts)) continue;
			matched = true;
			for (const action of rule.actions) {
				plan.push({
					rule,
					message,
					action,
					detail: action.kind === "move" ? folderName(action.folderId) : null,
				});
			}
			if (rule.actions.some(isMovingAction) || rule.stopOnMatch) break;
		}
		if (matched) tally.matched += 1;
	}

	// Before anything is done: a message is looked at once, whatever happens next.
	markSeen(db, accountId, candidates);

	const ofKind = (kind: MailRuleActionKind) => plan.filter((entry) => entry.action.kind === kind);

	const reads = ofKind("mark_read");
	for (const entry of reads.filter(alreadyDone)) tally[record(db, entry, "skipped", "Already read.")] += 1;
	await carryOut(db, reads.filter((entry) => !alreadyDone(entry)), isPaused, async (ids) => {
		await filing.setSeen(ids, true, db);
	}, tally);

	const flags = ofKind("flag");
	for (const entry of flags.filter(alreadyDone)) tally[record(db, entry, "skipped", "Already flagged.")] += 1;
	await carryOut(db, flags.filter((entry) => !alreadyDone(entry)), isPaused, async (ids) => {
		await filing.setFlagged(ids, true, db);
	}, tally);

	for (const entry of ofKind("link_client")) {
		if (isPaused()) tally[record(db, entry, "skipped", "Juno was locked before this could run.")] += 1;
		else tally[await linkToClient(db, entry)] += 1;
	}

	await carryOut(db, ofKind("trash"), isPaused, async (ids) => (await filing.trashMessages(ids, db)).folderName, tally);
	await carryOut(db, ofKind("archive"), isPaused, async (ids) => (await filing.archiveMessages(ids, db)).folderName, tally);
	for (const group of groupBy(ofKind("move"), (entry) => (entry.action.kind === "move" ? entry.action.folderId : ""))) {
		const action = group[0]!.action;
		if (action.kind !== "move") continue;
		await carryOut(db, group, isPaused, async (ids) => (await filing.move(ids, { folderId: action.folderId }, db)).folderName, tally);
	}

	return tally;
}
