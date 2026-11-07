/**
 * Intros and outros: lines added at the start and the end of a message.
 *
 * A block has a name, a Dutch text that may carry variables, and one rule for
 * when it is added without being asked. The composer, the manage screen and an
 * agent all go through here (decision 2).
 *
 * A block never sends anything and never touches a message that already has
 * one: `resolve` only says which block a new message would get, and the
 * composer puts its text in as ordinary editable text.
 *
 * Variables are stored as {{name}} tokens and drawn as chips by the interface.
 * A variable with no value for the message makes a rule not match, so a block
 * is never added automatically with a hole in it. A person can still pick it by
 * hand, and then the value is simply empty.
 */
import { and, asc, eq, isNull, max } from "drizzle-orm";
import type {
	ComposeBlock,
	ComposeBlockContext,
	ComposeBlockInput,
	ComposeBlockKind,
	ComposeBlockPatch,
	ComposeBlockRendered,
	ComposeBlockResolution,
	ComposeBlockRule,
	ComposeBlockVariable,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { LOCAL_OWNER_ID, now } from "../db/columns";
import { clients, mailBlocks, projects } from "../db/schema";
import { clientMatches } from "./mail-recipients";
import * as settings from "./settings";

export type MailBlockErrorCode = "invalid" | "not-found";

/** Written for a person, so both adapters can show `message` as it is. */
export class MailBlockError extends Error {
	readonly code: MailBlockErrorCode;
	constructor(code: MailBlockErrorCode, message: string) {
		super(message);
		this.name = "MailBlockError";
		this.code = code;
	}
}

export const KINDS: ComposeBlockKind[] = ["intro", "outro"];
export const RULES: ComposeBlockRule[] = ["manual", "client", "new_contact", "reply", "project"];
export const VARIABLES: ComposeBlockVariable[] = ["client_name", "first_name", "project", "date", "my_name"];

const MAX_NAME = 100;
const MAX_BODY = 2000;

/** 1 is the five examples on a first install and nothing else. */
export const MAIL_BLOCK_SEED_VERSION = 1;

type Row = typeof mailBlocks.$inferSelect;

function toBlock(row: Row): ComposeBlock {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		kind: row.kind as ComposeBlockKind,
		name: row.name,
		body: row.body,
		rule: row.rule as ComposeBlockRule,
		sortOrder: row.sortOrder,
	};
}

/* ------------------------------------------------------------ validation */

function cleanKind(value: string): ComposeBlockKind {
	if (!KINDS.includes(value as ComposeBlockKind)) {
		throw new MailBlockError("invalid", "A block is an intro or an outro.");
	}
	return value as ComposeBlockKind;
}

function cleanRule(value: string): ComposeBlockRule {
	if (!RULES.includes(value as ComposeBlockRule)) {
		throw new MailBlockError("invalid", `"${value}" is not a rule. Use ${RULES.join(", ")}.`);
	}
	return value as ComposeBlockRule;
}

function cleanName(value: string): string {
	const name = value.trim();
	if (!name) throw new MailBlockError("invalid", "Give the block a name.");
	if (name.length > MAX_NAME) {
		throw new MailBlockError("invalid", `The name can be at most ${MAX_NAME} characters.`);
	}
	return name;
}

/** The variables a text names, in order of first use. */
export function variablesIn(body: string): string[] {
	const found: string[] = [];
	for (const match of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
		if (!found.includes(match[1]!)) found.push(match[1]!);
	}
	return found;
}

/** Line breaks are kept, the ends are trimmed, and a token is written without spaces inside it. */
function cleanBody(value: string): string {
	const body = value
		.replace(/\r\n?/g, "\n")
		.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, "{{$1}}")
		.trim();
	if (!body) throw new MailBlockError("invalid", "Write the text.");
	if (body.length > MAX_BODY) {
		throw new MailBlockError("invalid", `The text can be at most ${MAX_BODY} characters.`);
	}
	const unknown = variablesIn(body).filter((name) => !VARIABLES.includes(name as ComposeBlockVariable));
	if (unknown.length > 0) {
		throw new MailBlockError(
			"invalid",
			`{{${unknown[0]}}} is not a variable. Use ${VARIABLES.map((name) => `{{${name}}}`).join(", ")}.`,
		);
	}
	return body;
}

/* ----------------------------------------------------------------- CRUD */

function alive(kind?: ComposeBlockKind) {
	return and(
		eq(mailBlocks.ownerId, LOCAL_OWNER_ID),
		isNull(mailBlocks.deletedAt),
		...(kind ? [eq(mailBlocks.kind, kind)] : []),
	);
}

/** Intros first, then outros, each in the owner's order. */
export function list(kind?: ComposeBlockKind, db: Db = getDb()): ComposeBlock[] {
	if (kind !== undefined) cleanKind(kind);
	return db
		.select()
		.from(mailBlocks)
		.where(alive(kind))
		.orderBy(asc(mailBlocks.kind), asc(mailBlocks.sortOrder), asc(mailBlocks.id))
		.all()
		.map(toBlock);
}

export function get(id: string, db: Db = getDb()): ComposeBlock {
	const row = db
		.select()
		.from(mailBlocks)
		.where(and(eq(mailBlocks.id, id), isNull(mailBlocks.deletedAt)))
		.get();
	if (!row) throw new MailBlockError("not-found", "That intro or outro does not exist.");
	return toBlock(row);
}

export function create(input: ComposeBlockInput, db: Db = getDb()): ComposeBlock {
	const kind = cleanKind(input.kind);
	const values = {
		kind,
		name: cleanName(input.name),
		body: cleanBody(input.body),
		rule: cleanRule(input.rule ?? "manual"),
	};
	const last = db.select({ value: max(mailBlocks.sortOrder) }).from(mailBlocks).where(alive(kind)).get();
	const stamp = now();
	const [row] = db
		.insert(mailBlocks)
		.values({
			...values,
			ownerId: LOCAL_OWNER_ID,
			sortOrder: (last?.value ?? -1) + 1,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.all();
	return toBlock(row!);
}

export function update(id: string, patch: ComposeBlockPatch, db: Db = getDb()): ComposeBlock {
	get(id, db);
	const values: Partial<Row> = {};
	if (patch.name !== undefined) values.name = cleanName(patch.name);
	if (patch.body !== undefined) values.body = cleanBody(patch.body);
	if (patch.rule !== undefined) values.rule = cleanRule(patch.rule);
	const [row] = db
		.update(mailBlocks)
		.set({ ...values, updatedAt: now() })
		.where(eq(mailBlocks.id, id))
		.returning()
		.all();
	return toBlock(row!);
}

/** Soft delete. Nothing points at a block, so there is nothing to protect. */
export function remove(id: string, db: Db = getDb()): ComposeBlock {
	get(id, db);
	const stamp = now();
	const [row] = db
		.update(mailBlocks)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailBlocks.id, id))
		.returning()
		.all();
	return toBlock(row!);
}

/**
 * Sets the order of one kind. The ids have to be exactly the live blocks of
 * that kind, each once, so a list that was out of date cannot drop one.
 */
export function reorder(kind: ComposeBlockKind, ids: string[], db: Db = getDb()): ComposeBlock[] {
	cleanKind(kind);
	const current = list(kind, db);
	const same =
		ids.length === current.length &&
		new Set(ids).size === ids.length &&
		current.every((block) => ids.includes(block.id));
	if (!same) {
		throw new MailBlockError("invalid", `Pass every ${kind} once. The list has changed, so reload it and try again.`);
	}
	const stamp = now();
	db.transaction((tx) => {
		ids.forEach((id, index) => {
			tx.update(mailBlocks).set({ sortOrder: index, updatedAt: stamp }).where(eq(mailBlocks.id, id)).run();
		});
	});
	return list(kind, db);
}

/* ------------------------------------------------------ values and rules */

interface Facts {
	values: Record<ComposeBlockVariable, string>;
	isClient: boolean;
	hasRecipient: boolean;
	hasProject: boolean;
	reply: boolean;
}

function firstWord(name: string | null | undefined): string {
	const word = (name ?? "").trim().split(/\s+/)[0] ?? "";
	return word.includes("@") ? "" : word;
}

async function ownerName(): Promise<string> {
	const owner = await settings.getOwner();
	const person = `${owner.firstName} ${owner.lastName}`.trim();
	return person || owner.businessName.trim();
}

async function gather(context: ComposeBlockContext, db: Db): Promise<Facts> {
	const to = context.to ?? [];
	const matches = clientMatches(
		db,
		to.map((address) => address.address),
	);

	let clientName = "";
	if (context.clientId) {
		clientName =
			db
				.select({ name: clients.name })
				.from(clients)
				.where(and(eq(clients.id, context.clientId), isNull(clients.deletedAt)))
				.get()?.name ?? "";
	}
	let first = "";
	for (const address of to) {
		const found = matches.get(address.address.trim().toLowerCase())?.[0];
		if (!clientName && found) clientName = found.clientName;
		if (!first) {
			first = firstWord(address.name) || (found?.source === "contact" ? firstWord(found.name) : "");
		}
	}

	let project = "";
	if (context.projectId) {
		project =
			db
				.select({ name: projects.name })
				.from(projects)
				.where(and(eq(projects.id, context.projectId), isNull(projects.deletedAt)))
				.get()?.name ?? "";
	}

	return {
		values: {
			client_name: clientName,
			first_name: first,
			project,
			date: new Date().toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" }),
			my_name: await ownerName(),
		},
		isClient: clientName !== "",
		hasRecipient: to.length > 0,
		hasProject: project !== "",
		reply: context.reply === true,
	};
}

/** What each variable would be for a message with these recipients, client and project. */
export async function valuesFor(
	context: ComposeBlockContext,
	db: Db = getDb(),
): Promise<Record<ComposeBlockVariable, string>> {
	return (await gather(context, db)).values;
}

function ruleMatches(rule: ComposeBlockRule, facts: Facts): boolean {
	switch (rule) {
		case "manual":
			return false;
		case "client":
			return facts.isClient;
		case "new_contact":
			return facts.hasRecipient && !facts.isClient;
		case "reply":
			return facts.reply;
		case "project":
			return facts.hasProject;
	}
}

function fill(block: ComposeBlock, facts: Facts): ComposeBlockRendered {
	const missing: ComposeBlockVariable[] = [];
	const text = block.body.replace(/\{\{([a-z_]+)\}\}/g, (_token, name: string) => {
		const value = facts.values[name as ComposeBlockVariable] ?? "";
		if (!value && !missing.includes(name as ComposeBlockVariable)) missing.push(name as ComposeBlockVariable);
		return value;
	});
	return { block, text, missing };
}

/** One block with its variables filled in for a message, whatever its rule says. */
export async function render(
	id: string,
	context: ComposeBlockContext = {},
	db: Db = getDb(),
): Promise<ComposeBlockRendered> {
	return fill(get(id, db), await gather(context, db));
}

/**
 * The intro and the outro a new message gets. For each kind, the first block in
 * the owner's order whose rule matches and whose variables all have a value.
 * Nothing matching is a null, and the message starts as it would have.
 */
export async function resolve(
	context: ComposeBlockContext = {},
	db: Db = getDb(),
): Promise<ComposeBlockResolution> {
	const facts = await gather(context, db);
	const pick = (kind: ComposeBlockKind): ComposeBlockRendered | null => {
		for (const block of list(kind, db)) {
			if (!ruleMatches(block.rule, facts)) continue;
			const rendered = fill(block, facts);
			if (rendered.missing.length === 0) return rendered;
		}
		return null;
	};
	return { intro: pick("intro"), outro: pick("outro") };
}

/* ------------------------------------------------------------------ seed */

const EXAMPLES: ComposeBlockInput[] = [
	{ kind: "intro", name: "Formal", body: "Geachte {{client_name}},", rule: "client" },
	{ kind: "intro", name: "Friendly", body: "Dag {{first_name}},", rule: "new_contact" },
	{ kind: "intro", name: "Short", body: "Dag,", rule: "reply" },
	{ kind: "outro", name: "Kind regards", body: "Met vriendelijke groeten,\n{{my_name}}", rule: "client" },
	{ kind: "outro", name: "Best wishes", body: "Hartelijke groeten,\n{{my_name}}", rule: "manual" },
];

/**
 * Writes the five examples once, on an install that has never had any. They are
 * ordinary rows from then on: the owner edits or deletes them, and no upgrade
 * or reset brings them back. Nothing may look one up by name.
 */
export async function ensureMailBlocksSeeded(db: Db = getDb()): Promise<{ created: number }> {
	const applied = await settings.getMailBlockSeedVersion();
	if (applied >= MAIL_BLOCK_SEED_VERSION) return { created: 0 };
	let created = 0;
	const empty = db.select({ id: mailBlocks.id }).from(mailBlocks).limit(1).get() === undefined;
	if (applied === 0 && empty) {
		for (const example of EXAMPLES) {
			create(example, db);
			created += 1;
		}
	}
	await settings.setMailBlockSeedVersion(MAIL_BLOCK_SEED_VERSION);
	return { created };
}
