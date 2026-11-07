/**
 * What was done, by whom, and to what.
 *
 * Every tool call that changes something writes a row here, whoever made it:
 * a person clicking, an agent over MCP, or an automation replaying. An agent
 * surface nobody can audit is an agent surface nobody should trust
 * (.claude/rules/mcp.md section 5).
 *
 * The arguments themselves are not copied. A digest of them is, so two calls
 * can be told apart and a retry recognised, and the one-line summary says what
 * happened in words. A log that quietly held every mail body would be a second
 * copy of the business in a table nobody thinks about.
 */
import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or, type SQL } from "drizzle-orm";
import type {
	AgentActionState,
	AuditActor,
	AuditEvent,
	AuditListQuery,
	AuditResult,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { agentActions, auditEvents } from "../db/schema";

type Row = typeof auditEvents.$inferSelect;

const MAX_LIMIT = 500;

function toRecord(row: Row): AuditEvent {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		actor: row.actor as AuditActor,
		toolName: row.toolName,
		argsDigest: row.argsDigest,
		summary: row.summary,
		result: row.result as AuditResult,
		entityType: row.entityType,
		entityId: row.entityId,
		actionId: row.actionId,
		error: row.error,
	};
}

/**
 * A stable digest of an argument object.
 *
 * Keys are sorted so the same call always digests the same way regardless of
 * the order an agent happened to write them in.
 */
export function digestArgs(args: unknown): string {
	return createHash("sha256").update(canonical(args)).digest("hex").slice(0, 16);
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export interface RecordInput {
	actor: AuditActor;
	toolName: string;
	args: unknown;
	summary: string;
	result: AuditResult;
	entityType?: string | null;
	entityId?: string | null;
	actionId?: string | null;
	error?: string | null;
}

/** A read of the same tool by the same caller inside this window is one row, not a stream. */
const READ_DEDUPE_MS = 30_000;

/** Reads that only let a caller follow its own requests. They are polled, and say nothing about the business. */
const UNLOGGED_READS = new Set(["agent.get_action", "agent.list_actions"]);

export interface ReadInput {
	actor: AuditActor;
	toolName: string;
	/** The tool's own title. No argument is copied, so no search text, id or body can reach the log. */
	title: string;
}

/**
 * Logs that a caller looked, and nothing about what it saw. The row has no
 * argument digest worth reading (it digests an empty object), no entity and no
 * result, so a mail body or a search term cannot end up here. Repeats inside
 * thirty seconds collapse into the first, and reads are purged sooner than
 * writes (purgeOldEvents). Never throws, like record.
 */
export function recordRead(input: ReadInput, db: Db = getDb(), now: Date = new Date()): AuditEvent | null {
	if (UNLOGGED_READS.has(input.toolName)) return null;
	try {
		const since = new Date(now.getTime() - READ_DEDUPE_MS).toISOString();
		const recent = db
			.select({ id: auditEvents.id })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.toolName, input.toolName),
					eq(auditEvents.actor, input.actor),
					eq(auditEvents.result, "read"),
					gte(auditEvents.createdAt, since),
				),
			)
			.get();
		if (recent) return null;
	} catch {
		return null;
	}
	return record({ actor: input.actor, toolName: input.toolName, args: {}, summary: input.title, result: "read" }, db);
}

/**
 * Writes one row. Never throws: a log that can break the call it is logging is
 * worse than a gap in the log, and the caller has already done the work.
 */
export function record(input: RecordInput, db: Db = getDb()): AuditEvent | null {
	try {
		const [row] = db
			.insert(auditEvents)
			.values({
				actor: input.actor,
				toolName: input.toolName,
				argsDigest: digestArgs(input.args),
				summary: input.summary,
				result: input.result,
				entityType: input.entityType ?? null,
				entityId: input.entityId ?? null,
				actionId: input.actionId ?? null,
				error: input.error ?? null,
			})
			.returning()
			.all();
		return row ? toRecord(row) : null;
	} catch {
		return null;
	}
}

export async function list(query: AuditListQuery = {}, db: Db = getDb()): Promise<AuditEvent[]> {
	const limit = Math.min(Math.max(query.limit ?? 100, 1), MAX_LIMIT);
	const conditions: SQL[] = [isNull(auditEvents.deletedAt)];
	if (query.actor) conditions.push(eq(auditEvents.actor, query.actor));
	if (query.toolName) conditions.push(eq(auditEvents.toolName, query.toolName));
	if (query.since) conditions.push(gte(auditEvents.createdAt, query.since));
	return db
		.select()
		.from(auditEvents)
		.where(and(...conditions))
		// The id breaks the tie, and it has to. createdAt is an ISO string with
		// millisecond resolution, so two events written in the same millisecond
		// sort arbitrarily, and this is the log whose entire job is saying what
		// happened in what order. The id is UUIDv7 and monotonic inside a
		// millisecond, so it continues the same ordering rather than inventing one.
		.orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
		.limit(limit)
		.all()
		.map(toRecord);
}

/** Everything that happened to one record, for the history on its own screen. */
export async function listForEntity(
	entityType: string,
	entityId: string,
	db: Db = getDb(),
): Promise<AuditEvent[]> {
	return db
		.select()
		.from(auditEvents)
		.where(
			and(
				isNull(auditEvents.deletedAt),
				eq(auditEvents.entityType, entityType),
				eq(auditEvents.entityId, entityId),
			),
		)
		.orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
		.limit(MAX_LIMIT)
		.all()
		.map(toRecord);
}

/**
 * How many times each tool ran for an agent or an automation, from the rows the
 * log still holds. A call parked for approval counts once it has run, not while
 * it waits. Reads that repeat inside thirty seconds are one row, so this is a
 * floor for a busy read tool, which is all the settings page claims.
 */
export function callCounts(db: Db = getDb()): Map<string, number> {
	const rows = db
		.select({ toolName: auditEvents.toolName, calls: count() })
		.from(auditEvents)
		.where(and(isNull(auditEvents.deletedAt), ne(auditEvents.actor, "user"), inArray(auditEvents.result, ["ok", "failed", "read"])))
		.groupBy(auditEvents.toolName)
		.all();
	return new Map(rows.map((row) => [row.toolName, row.calls]));
}

/** States that mean a request has not been closed yet (agent-actions.ts). */
const OPEN_ACTION_STATES: AgentActionState[] = ["pending", "approved"];

/** How long a row lives before it is eligible for the purge below. */
const RETENTION_MONTHS = 6;

/** Reads are many and say little, so they live a month and never more than this many. */
const READ_RETENTION_DAYS = 30;
const READ_KEEP = 2000;

/**
 * Deletes rows older than six months, and returns how many.
 *
 * This is the one place in the app that hard-deletes rather than soft-deletes
 * (.claude/rules/data.md section 6). An audit row is the log itself, not a
 * record anything else is built from: the client timeline reads notes,
 * documents and mail directly, never this table, so nothing on a timeline
 * disappears when a row here is gone. Retention is the owner's decision
 * (decision 24): it runs on launch, and the owner can run it from Settings >
 * Security and data. It is never an MCP tool, because an agent must not be
 * able to erase its own trail.
 *
 * A row an open request still points at survives regardless of age, because
 * a request's own history has to stay legible until somebody closes it.
 */
export function purgeOldEvents(db: Db = getDb(), now: Date = new Date()): number {
	const cutoff = new Date(now);
	cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
	const cutoffIso = cutoff.toISOString();

	const readCutoff = new Date(now.getTime() - READ_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

	return db.transaction((tx) => {
		// Reads first: older than a month, or beyond the newest READ_KEEP.
		const oldReads = tx.select({ count: count() }).from(auditEvents).where(and(eq(auditEvents.result, "read"), lt(auditEvents.createdAt, readCutoff))).get()?.count ?? 0;
		if (oldReads > 0) tx.delete(auditEvents).where(and(eq(auditEvents.result, "read"), lt(auditEvents.createdAt, readCutoff))).run();
		const keepFrom = tx
			.select({ createdAt: auditEvents.createdAt })
			.from(auditEvents)
			.where(eq(auditEvents.result, "read"))
			.orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
			.limit(1)
			.offset(READ_KEEP)
			.get();
		let extraReads = 0;
		if (keepFrom) {
			const over = and(eq(auditEvents.result, "read"), lte(auditEvents.createdAt, keepFrom.createdAt));
			extraReads = tx.select({ count: count() }).from(auditEvents).where(over).get()?.count ?? 0;
			tx.delete(auditEvents).where(over).run();
		}

		const openActionIds = tx
			.select({ id: agentActions.id })
			.from(agentActions)
			.where(inArray(agentActions.state, OPEN_ACTION_STATES))
			.all()
			.map((row) => row.id);

		const conditions = [
			lt(auditEvents.createdAt, cutoffIso),
			openActionIds.length > 0
				? or(isNull(auditEvents.actionId), notInArray(auditEvents.actionId, openActionIds))
				: undefined,
		];

		// Counted and deleted by the same condition rather than by a list of
		// ids: the first launch after a long gap can find more rows than SQLite
		// accepts as bound parameters in one statement.
		const where = and(...conditions);
		const due = tx.select({ count: count() }).from(auditEvents).where(where).get()?.count ?? 0;
		if (due > 0) tx.delete(auditEvents).where(where).run();
		return due + oldReads + extraReads;
	});
}
