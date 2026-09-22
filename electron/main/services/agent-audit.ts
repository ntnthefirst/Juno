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
import { and, desc, eq, gte, isNull, type SQL } from "drizzle-orm";
import type { AuditActor, AuditEvent, AuditListQuery, AuditResult } from "../../shared/types";
import { getDb, type Db } from "../db";
import { auditEvents } from "../db/schema";

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
