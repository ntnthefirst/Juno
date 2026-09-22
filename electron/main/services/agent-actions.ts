/**
 * The confirmation gate.
 *
 * A side-effectful tool call from an agent does not execute. It parks here
 * with its arguments, a person reads what it would do and approves or rejects
 * it, and only then does the service behind the tool run
 * (.claude/rules/mcp.md section 4).
 *
 * Three rules this file exists to keep:
 *
 * - **Approving is a person at the keyboard.** `approve` has an IPC channel
 *   and no MCP tool, exactly like the outbox's approval (decision 22). Adding
 *   one would make the gate decorative, because the thing being gated is what
 *   would call it.
 * - **Consent is per action.** There is no "approve this tool from now on".
 *   A rejected or expired action is never retried on its own.
 * - **A stale request is not a standing permission.** An action nobody
 *   answered expires, and expired cannot be approved.
 *
 * The executor is injected at startup rather than imported, because the
 * registry that knows how to run a tool imports the services this file lives
 * beside. Same reason the mailbox source and the PDF renderer are injected.
 */
import { and, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import type {
	AgentAction,
	AgentActionListQuery,
	AgentActionSource,
	AgentActionState,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { agentActions } from "../db/schema";
import * as audit from "./agent-audit";

type Row = typeof agentActions.$inferSelect;

/**
 * How long a request stays approvable.
 *
 * A day, so a request made in the evening is still answerable the next
 * morning, and one from last week is not. The number matters less than the
 * fact that there is one.
 */
export const EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;

const STATES: AgentActionState[] = ["pending", "approved", "rejected", "expired", "executed", "failed"];

/** Runs the tool behind an approved action. Injected at startup. */
export type ActionExecutor = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

let execute: ActionExecutor | null = null;

export function configureAgentActions(executor: ActionExecutor): void {
	execute = executor;
}

type Listener = (action: AgentAction) => void;
const listeners = new Set<Listener>();

/** Fires whenever an action is created or changes state, so the app can show it. */
export function onChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function announce(action: AgentAction): AgentAction {
	for (const listener of listeners) {
		try {
			listener(action);
		} catch {
			// A listener that throws is not allowed to break the gate.
		}
	}
	return action;
}

function parseArgs(json: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(json);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function toRecord(row: Row): AgentAction {
	let result: unknown = null;
	if (row.resultJson) {
		try {
			result = JSON.parse(row.resultJson);
		} catch {
			result = null;
		}
	}
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		toolName: row.toolName,
		args: parseArgs(row.argsJson),
		summary: row.summary,
		state: row.state as AgentActionState,
		source: row.source as AgentActionSource,
		automationRunId: row.automationRunId,
		expiresAt: row.expiresAt,
		decidedAt: row.decidedAt,
		executedAt: row.executedAt,
		result,
		error: row.error,
	};
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(agentActions)
		.where(and(eq(agentActions.id, id), isNull(agentActions.deletedAt)))
		.get();
	if (!row) throw new Error(`No pending action with id "${id}".`);
	return row;
}

/**
 * Marks everything past its expiry as expired.
 *
 * Run before every read, so a list can never offer an approve button for an
 * action that is already too old, and nothing has to sweep on a timer.
 */
export function expireStale(db: Db = getDb()): number {
	const rows = db
		.update(agentActions)
		.set({ state: "expired", decidedAt: now(), updatedAt: now() })
		.where(and(eq(agentActions.state, "pending"), lt(agentActions.expiresAt, now())))
		.returning()
		.all();
	for (const row of rows) {
		audit.record(
			{
				actor: "agent",
				toolName: row.toolName,
				args: parseArgs(row.argsJson),
				summary: row.summary,
				result: "expired",
				actionId: row.id,
			},
			db,
		);
		announce(toRecord(row));
	}
	return rows.length;
}

export interface RequestInput {
	toolName: string;
	args: Record<string, unknown>;
	/** One line a person reads before approving. */
	summary: string;
	source: AgentActionSource;
	automationRunId?: string | null;
}

/**
 * Parks a call. Returns the pending action, which is what the tool hands back
 * to its caller: the agent learns the request was made, never that it ran.
 */
export async function request(input: RequestInput, db: Db = getDb()): Promise<AgentAction> {
	if (!input.toolName.trim()) throw new Error("An action needs a tool name.");
	const [row] = db
		.insert(agentActions)
		.values({
			toolName: input.toolName,
			argsJson: JSON.stringify(input.args ?? {}),
			summary: input.summary,
			state: "pending",
			source: input.source,
			automationRunId: input.automationRunId ?? null,
			expiresAt: new Date(Date.now() + EXPIRES_AFTER_MS).toISOString(),
		})
		.returning()
		.all();

	const action = toRecord(row!);
	audit.record(
		{
			actor: input.source === "automation" ? "automation" : "agent",
			toolName: action.toolName,
			args: action.args,
			summary: action.summary,
			result: "pending",
			actionId: action.id,
		},
		db,
	);
	return announce(action);
}

export async function get(id: string, db: Db = getDb()): Promise<AgentAction | null> {
	expireStale(db);
	const row = db
		.select()
		.from(agentActions)
		.where(and(eq(agentActions.id, id), isNull(agentActions.deletedAt)))
		.get();
	return row ? toRecord(row) : null;
}

export async function list(
	query: AgentActionListQuery = {},
	db: Db = getDb(),
): Promise<AgentAction[]> {
	expireStale(db);
	const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
	const conditions: SQL[] = [isNull(agentActions.deletedAt)];
	if (query.states && query.states.length > 0) {
		for (const state of query.states) {
			if (!STATES.includes(state)) throw new Error(`"${state}" is not an action state.`);
		}
		conditions.push(inArray(agentActions.state, query.states));
	}
	return db
		.select()
		.from(agentActions)
		.where(and(...conditions))
		.orderBy(desc(agentActions.createdAt))
		.limit(limit)
		.all()
		.map(toRecord);
}

export async function pendingCount(db: Db = getDb()): Promise<number> {
	expireStale(db);
	return db
		.select({ id: agentActions.id })
		.from(agentActions)
		.where(and(eq(agentActions.state, "pending"), isNull(agentActions.deletedAt)))
		.all().length;
}

/**
 * Runs an approved action.
 *
 * **Only a person reaches this.** The IPC channel is the only caller, and
 * there is no MCP tool, because the thing being gated is what would call it.
 */
export async function approve(id: string, db: Db = getDb()): Promise<AgentAction> {
	expireStale(db);
	const row = requireRow(id, db);
	if (row.state !== "pending") {
		throw new Error(
			row.state === "expired"
				? "That request is too old to approve. Ask the agent to make it again."
				: `That request was already ${row.state}.`,
		);
	}
	if (!execute) throw new Error("The tool surface is not ready yet. Try again in a moment.");

	db.update(agentActions)
		.set({ state: "approved", decidedAt: now(), updatedAt: now() })
		.where(eq(agentActions.id, id))
		.run();

	const args = parseArgs(row.argsJson);
	try {
		const result = await execute(row.toolName, args);
		const [updated] = db
			.update(agentActions)
			.set({
				state: "executed",
				executedAt: now(),
				resultJson: JSON.stringify(result ?? null),
				error: null,
				updatedAt: now(),
			})
			.where(eq(agentActions.id, id))
			.returning()
			.all();
		const action = toRecord(updated!);
		audit.record(
			{
				actor: row.source === "automation" ? "automation" : "agent",
				toolName: row.toolName,
				args,
				summary: row.summary,
				result: "ok",
				actionId: id,
				...entityOf(result),
			},
			db,
		);
		return announce(action);
	} catch (cause: unknown) {
		const message = cause instanceof Error ? cause.message : String(cause);
		const [updated] = db
			.update(agentActions)
			.set({ state: "failed", executedAt: now(), error: message, updatedAt: now() })
			.where(eq(agentActions.id, id))
			.returning()
			.all();
		audit.record(
			{
				actor: row.source === "automation" ? "automation" : "agent",
				toolName: row.toolName,
				args,
				summary: row.summary,
				result: "failed",
				actionId: id,
				error: message,
			},
			db,
		);
		announce(toRecord(updated!));
		throw cause;
	}
}

export async function reject(id: string, db: Db = getDb()): Promise<AgentAction> {
	expireStale(db);
	const row = requireRow(id, db);
	if (row.state !== "pending") throw new Error(`That request was already ${row.state}.`);
	const [updated] = db
		.update(agentActions)
		.set({ state: "rejected", decidedAt: now(), updatedAt: now() })
		.where(eq(agentActions.id, id))
		.returning()
		.all();
	audit.record(
		{
			actor: row.source === "automation" ? "automation" : "agent",
			toolName: row.toolName,
			args: parseArgs(row.argsJson),
			summary: row.summary,
			result: "rejected",
			actionId: id,
		},
		db,
	);
	return announce(toRecord(updated!));
}

/** Clears an answered action from the list. The audit row stays. */
export async function remove(id: string, db: Db = getDb()): Promise<AgentAction> {
	const row = requireRow(id, db);
	if (row.state === "pending") throw new Error("Answer this request before clearing it.");
	const [updated] = db
		.update(agentActions)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(agentActions.id, id))
		.returning()
		.all();
	return toRecord(updated!);
}

/** A row id out of a service result, so the audit row points at what changed. */
function entityOf(result: unknown): { entityType?: string; entityId?: string } {
	if (!result || typeof result !== "object") return {};
	const record = result as Record<string, unknown>;
	const id = record.id;
	if (typeof id !== "string") return {};
	return { entityId: id };
}

export function resetForTests(): void {
	execute = null;
	listeners.clear();
}
