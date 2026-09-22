/**
 * Automations: a stored list of tool calls with a trigger.
 *
 * Decision 2 restated as code. An automation is not a second engine and has no
 * interpreter of its own: a step is a tool name and an argument object, and
 * running one calls exactly what an agent or the window would call. So the
 * same validation applies, and so does the same confirmation gate.
 *
 * That last part is the whole point. **A step that needs a person's approval
 * stops the run.** It does not skip it, it does not continue past it, and it
 * cannot be pre-approved by putting it in an automation. The run parks, the
 * person answers in the app, and the run picks up from the step after it. An
 * automation that could send mail on a timer would make the rule in
 * .claude/rules/mcp.md section 4 false, so it cannot.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type {
	Automation,
	AutomationInput,
	AutomationPatch,
	AutomationRun,
	AutomationRunLogEntry,
	AutomationRunStatus,
	AutomationStep,
	AutomationTrigger,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { automationRuns, automations } from "../db/schema";
import * as actions from "./agent-actions";
import { todayIsoDate } from "./document-context";

type Row = typeof automations.$inferSelect;
type RunRow = typeof automationRuns.$inferSelect;

/** Bound on one run, so a mistake cannot become a loop that never ends. */
const MAX_STEPS = 50;

export interface AutomationRuntime {
	/** Calls a tool the way an agent does, gate and all. */
	callTool: (
		tool: string,
		args: Record<string, unknown>,
		options: { source: "automation"; automationRunId: string },
	) => Promise<unknown>;
	hasTool: (name: string) => boolean;
}

let runtime: AutomationRuntime | null = null;

export function configureAutomations(next: AutomationRuntime): void {
	runtime = next;
}

function requireRuntime(): AutomationRuntime {
	if (!runtime) throw new Error("The tool surface is not ready yet. Try again in a moment.");
	return runtime;
}

type Listener = (run: AutomationRun) => void;
const listeners = new Set<Listener>();

export function onRunChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function announce(run: AutomationRun): AutomationRun {
	for (const listener of listeners) {
		try {
			listener(run);
		} catch {
			// A listener is never allowed to break a run.
		}
	}
	return run;
}

/* ------------------------------------------------------------ parse, shape */

function parseTrigger(json: string): AutomationTrigger {
	try {
		const value = JSON.parse(json) as AutomationTrigger;
		if (value && typeof value === "object" && "kind" in value) return value;
	} catch {
		// Falls through to the safe default.
	}
	return { kind: "manual" };
}

function parseSteps(json: string): AutomationStep[] {
	try {
		const value: unknown = JSON.parse(json);
		if (!Array.isArray(value)) return [];
		return value.filter(
			(step): step is AutomationStep =>
				Boolean(step) && typeof step === "object" && typeof (step as AutomationStep).tool === "string",
		);
	} catch {
		return [];
	}
}

function parseLog(json: string): AutomationRunLogEntry[] {
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) ? (value as AutomationRunLogEntry[]) : [];
	} catch {
		return [];
	}
}

function toRecord(row: Row, lastStatus: AutomationRunStatus | null): Automation {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		name: row.name,
		description: row.description,
		trigger: parseTrigger(row.triggerJson),
		steps: parseSteps(row.stepsJson),
		enabled: row.enabled,
		lastRunAt: row.lastRunAt,
		lastRunOn: row.lastRunOn,
		lastStatus,
	};
}

function toRun(row: RunRow, automationName: string): AutomationRun {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		automationId: row.automationId,
		automationName,
		startedBy: row.startedBy as AutomationRun["startedBy"],
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		status: row.status as AutomationRunStatus,
		log: parseLog(row.logJson),
		stoppedAtStep: row.stoppedAtStep,
		error: row.error,
	};
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function checkTrigger(trigger: AutomationTrigger): void {
	if (trigger.kind === "manual") return;
	if (trigger.kind === "daily" || trigger.kind === "weekly") {
		if (!TIME.test(trigger.time)) {
			throw new Error(`"${trigger.time}" is not a time of day. Use 24-hour HH:MM, like 08:30.`);
		}
		if (trigger.kind === "weekly" && (trigger.weekday < 1 || trigger.weekday > 7)) {
			throw new Error("A weekday is 1 for Monday through 7 for Sunday.");
		}
		return;
	}
	throw new Error("A trigger is manual, daily or weekly.");
}

function checkSteps(steps: AutomationStep[]): AutomationStep[] {
	if (!Array.isArray(steps) || steps.length === 0) {
		throw new Error("An automation needs at least one step.");
	}
	if (steps.length > MAX_STEPS) {
		throw new Error(`An automation can have at most ${MAX_STEPS} steps.`);
	}
	const known = requireRuntime();
	return steps.map((step, index) => {
		const tool = String(step.tool ?? "").trim();
		if (!tool) throw new Error(`Step ${index + 1} has no tool.`);
		if (!known.hasTool(tool)) throw new Error(`Step ${index + 1} names "${tool}", which is not a tool.`);
		const args = step.args ?? {};
		if (typeof args !== "object" || Array.isArray(args)) {
			throw new Error(`Step ${index + 1} needs its arguments as an object.`);
		}
		return { tool, args: args as Record<string, unknown> };
	});
}

/* ------------------------------------------------------------------- reads */

function lastStatusOf(automationId: string, db: Db): AutomationRunStatus | null {
	const row = db
		.select({ status: automationRuns.status })
		.from(automationRuns)
		.where(and(eq(automationRuns.automationId, automationId), isNull(automationRuns.deletedAt)))
		.orderBy(desc(automationRuns.startedAt))
		.limit(1)
		.get();
	return (row?.status as AutomationRunStatus | undefined) ?? null;
}

export async function list(db: Db = getDb()): Promise<Automation[]> {
	return db
		.select()
		.from(automations)
		.where(isNull(automations.deletedAt))
		.orderBy(automations.name)
		.all()
		.map((row) => toRecord(row, lastStatusOf(row.id, db)));
}

export async function get(id: string, db: Db = getDb()): Promise<Automation | null> {
	const row = db
		.select()
		.from(automations)
		.where(and(eq(automations.id, id), isNull(automations.deletedAt)))
		.get();
	return row ? toRecord(row, lastStatusOf(row.id, db)) : null;
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(automations)
		.where(and(eq(automations.id, id), isNull(automations.deletedAt)))
		.get();
	if (!row) throw new Error(`No automation with id "${id}".`);
	return row;
}

export async function runs(
	automationId?: string,
	limit = 50,
	db: Db = getDb(),
): Promise<AutomationRun[]> {
	const conditions = [isNull(automationRuns.deletedAt)];
	if (automationId) conditions.push(eq(automationRuns.automationId, automationId));
	const rows = db
		.select({ run: automationRuns, name: automations.name })
		.from(automationRuns)
		.innerJoin(automations, eq(automationRuns.automationId, automations.id))
		.where(and(...conditions))
		.orderBy(desc(automationRuns.startedAt))
		.limit(Math.min(Math.max(limit, 1), 200))
		.all();
	return rows.map((row) => toRun(row.run, row.name));
}

export async function getRun(id: string, db: Db = getDb()): Promise<AutomationRun | null> {
	const row = db
		.select({ run: automationRuns, name: automations.name })
		.from(automationRuns)
		.innerJoin(automations, eq(automationRuns.automationId, automations.id))
		.where(and(eq(automationRuns.id, id), isNull(automationRuns.deletedAt)))
		.get();
	return row ? toRun(row.run, row.name) : null;
}

/* ------------------------------------------------------------------ writes */

export async function create(input: AutomationInput, db: Db = getDb()): Promise<Automation> {
	const name = (input.name ?? "").trim();
	if (!name) throw new Error("An automation needs a name.");
	const trigger = input.trigger ?? { kind: "manual" };
	checkTrigger(trigger);
	const steps = checkSteps(input.steps);

	const [row] = db
		.insert(automations)
		.values({
			name,
			description: input.description?.trim() || null,
			triggerJson: JSON.stringify(trigger),
			stepsJson: JSON.stringify(steps),
			enabled: input.enabled ?? true,
		})
		.returning()
		.all();
	return toRecord(row!, null);
}

export async function update(
	id: string,
	patch: AutomationPatch,
	db: Db = getDb(),
): Promise<Automation> {
	const row = requireRow(id, db);
	if (patch.name !== undefined && !patch.name.trim()) throw new Error("An automation needs a name.");
	if (patch.trigger !== undefined) checkTrigger(patch.trigger);
	const steps = patch.steps !== undefined ? checkSteps(patch.steps) : null;

	const [updated] = db
		.update(automations)
		.set({
			...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
			...(patch.trigger !== undefined ? { triggerJson: JSON.stringify(patch.trigger) } : {}),
			...(steps ? { stepsJson: JSON.stringify(steps) } : {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			updatedAt: now(),
		})
		.where(eq(automations.id, row.id))
		.returning()
		.all();
	return toRecord(updated!, lastStatusOf(id, db));
}

export async function setEnabled(
	id: string,
	enabled: boolean,
	db: Db = getDb(),
): Promise<Automation> {
	return update(id, { enabled }, db);
}

export async function remove(id: string, db: Db = getDb()): Promise<Automation> {
	const row = requireRow(id, db);
	const [updated] = db
		.update(automations)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(automations.id, row.id))
		.returning()
		.all();
	return toRecord(updated!, lastStatusOf(id, db));
}

/* ------------------------------------------------------------------ running */

function isPending(result: unknown): result is { status: "pending"; actionId: string; summary: string } {
	return (
		Boolean(result) &&
		typeof result === "object" &&
		(result as { status?: unknown }).status === "pending" &&
		typeof (result as { actionId?: unknown }).actionId === "string"
	);
}

function finish(
	runId: string,
	status: AutomationRunStatus,
	log: AutomationRunLogEntry[],
	extra: { stoppedAtStep?: number | null; error?: string | null },
	db: Db,
): AutomationRun {
	const [row] = db
		.update(automationRuns)
		.set({
			status,
			logJson: JSON.stringify(log),
			finishedAt: status === "waiting" ? null : now(),
			stoppedAtStep: extra.stoppedAtStep ?? null,
			error: extra.error ?? null,
			updatedAt: now(),
		})
		.where(eq(automationRuns.id, runId))
		.returning()
		.all();
	const name = db
		.select({ name: automations.name })
		.from(automations)
		.where(eq(automations.id, row!.automationId))
		.get();
	return announce(toRun(row!, name?.name ?? ""));
}

/**
 * Walks the steps from `startAt`, stopping at the first one that needs a
 * person or fails. Shared by a fresh run and one resuming after an approval.
 */
async function walk(
	runId: string,
	steps: AutomationStep[],
	startAt: number,
	log: AutomationRunLogEntry[],
	db: Db,
): Promise<AutomationRun> {
	const { callTool } = requireRuntime();

	for (let index = startAt; index < steps.length; index++) {
		const step = steps[index]!;
		try {
			const result = await callTool(step.tool, step.args, {
				source: "automation",
				automationRunId: runId,
			});
			if (isPending(result)) {
				log.push({
					step: index,
					tool: step.tool,
					outcome: "waiting",
					at: now(),
					actionId: result.actionId,
					detail: "Waiting for you to approve this step.",
				});
				return finish(runId, "waiting", log, { stoppedAtStep: index }, db);
			}
			log.push({ step: index, tool: step.tool, outcome: "ran", at: now(), detail: detailOf(result) });
		} catch (cause: unknown) {
			const message = cause instanceof Error ? cause.message : String(cause);
			log.push({ step: index, tool: step.tool, outcome: "failed", at: now(), detail: message });
			return finish(runId, "failed", log, { stoppedAtStep: index, error: message }, db);
		}
	}
	return finish(runId, "done", log, {}, db);
}

/** A readable line, never the whole result: a run log is not a second copy of the data. */
function detailOf(result: unknown): string {
	if (result === null || result === undefined) return "ok";
	if (Array.isArray(result)) return `${result.length} row${result.length === 1 ? "" : "s"}`;
	if (typeof result === "object") {
		const record = result as Record<string, unknown>;
		if (typeof record.title === "string") return record.title;
		if (typeof record.name === "string") return record.name;
		if (typeof record.id === "string") return record.id;
		return "ok";
	}
	return String(result).slice(0, 80);
}

/**
 * `today` is the **local** calendar date, and it is what `lastRunOn` records.
 *
 * Stamping the UTC date here and comparing it against a local one in `due()`
 * would fire a daily automation twice between midnight and the offset, every
 * night, in every zone east of UTC.
 */
export async function run(
	id: string,
	startedBy: AutomationRun["startedBy"] = "manual",
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<AutomationRun> {
	const row = requireRow(id, db);
	const steps = parseSteps(row.stepsJson);
	if (steps.length === 0) throw new Error("That automation has no steps.");

	const [runRow] = db
		.insert(automationRuns)
		.values({ automationId: row.id, startedBy, startedAt: now(), status: "running" })
		.returning()
		.all();

	db.update(automations)
		.set({ lastRunAt: now(), lastRunOn: today, updatedAt: now() })
		.where(eq(automations.id, row.id))
		.run();

	return walk(runRow!.id, steps, 0, [], db);
}

/**
 * Picks a waiting run back up.
 *
 * Called when the action a run stopped on is answered. An approved step is
 * behind us, so the run continues from the next one; a rejected or expired one
 * ends the run, because continuing past a refused step is exactly what
 * "it does not skip" forbids.
 */
export async function resumeForAction(
	actionId: string,
	outcome: "executed" | "failed" | "rejected" | "expired",
	db: Db = getDb(),
): Promise<AutomationRun | null> {
	const waiting = db
		.select()
		.from(automationRuns)
		.where(and(eq(automationRuns.status, "waiting"), isNull(automationRuns.deletedAt)))
		.all()
		.find((row) => parseLog(row.logJson).some((entry) => entry.actionId === actionId));
	if (!waiting) return null;

	const log = parseLog(waiting.logJson);
	const entry = log.find((item) => item.actionId === actionId);
	const stoppedAt = entry?.step ?? waiting.stoppedAtStep ?? 0;

	if (outcome !== "executed") {
		log.push({
			step: stoppedAt,
			tool: entry?.tool ?? "",
			outcome: "failed",
			at: now(),
			detail:
				outcome === "failed"
					? "The approved step failed, so the run stopped."
					: `The step was ${outcome}, so the run stopped.`,
		});
		return finish(waiting.id, outcome === "failed" ? "failed" : "cancelled", log, { stoppedAtStep: stoppedAt }, db);
	}

	if (entry) entry.outcome = "ran";
	const automation = db
		.select()
		.from(automations)
		.where(eq(automations.id, waiting.automationId))
		.get();
	if (!automation) return null;

	db.update(automationRuns).set({ status: "running", updatedAt: now() }).where(eq(automationRuns.id, waiting.id)).run();
	return walk(waiting.id, parseSteps(automation.stepsJson), stoppedAt + 1, log, db);
}

export async function cancelRun(id: string, db: Db = getDb()): Promise<AutomationRun> {
	const row = db
		.select()
		.from(automationRuns)
		.where(and(eq(automationRuns.id, id), isNull(automationRuns.deletedAt)))
		.get();
	if (!row) throw new Error(`No run with id "${id}".`);
	if (row.status !== "waiting" && row.status !== "running") {
		throw new Error(`That run already ${row.status === "done" ? "finished" : row.status}.`);
	}
	const log = parseLog(row.logJson);
	// The step it was waiting on is refused too, or approving it later would
	// restart a run somebody stopped on purpose.
	for (const entry of log) {
		if (entry.outcome === "waiting" && entry.actionId) {
			await actions.reject(entry.actionId, db).catch(() => undefined);
			entry.outcome = "skipped";
			entry.detail = "You cancelled the run.";
		}
	}
	return finish(row.id, "cancelled", log, { stoppedAtStep: row.stoppedAtStep }, db);
}

/* ---------------------------------------------------------------- schedule */

/**
 * Which automations a trigger says are due, given the local date and time.
 *
 * `lastRunOn` is the date it last ran on, so a daily trigger fires once a day
 * even if the app is opened and closed ten times, and a machine that was off
 * at 08:00 runs it when it comes back rather than skipping the day.
 */
export async function due(
	today: string,
	time: string,
	db: Db = getDb(),
): Promise<Automation[]> {
	const weekday = isoWeekday(today);
	return (await list(db)).filter((automation) => {
		if (!automation.enabled) return false;
		if (automation.lastRunOn === today) return false;
		const trigger = automation.trigger;
		if (trigger.kind === "manual") return false;
		if (trigger.kind === "weekly" && trigger.weekday !== weekday) return false;
		return time >= trigger.time;
	});
}

/** 1 for Monday through 7 for Sunday, read from a date with no zone involved. */
export function isoWeekday(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
	return day === 0 ? 7 : day;
}

export function resetForTests(): void {
	runtime = null;
	listeners.clear();
}
