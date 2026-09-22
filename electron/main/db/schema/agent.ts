import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";

/**
 * What an agent asked for, what it was allowed to do, and what it did.
 *
 * Three tables, one per question:
 *
 * - `agent_actions` is the confirmation gate. A side-effectful tool call does
 *   not execute; it parks here with its arguments rendered for a person to
 *   read, and executes only after somebody approves it in the app
 *   (.claude/rules/mcp.md section 4).
 * - `audit_events` is the record. Every call that changed something, whoever
 *   made it, with a digest of the arguments so two calls can be told apart.
 * - `automations` and `automation_runs` are recorded sequences of tool calls
 *   and their logs. Not a second engine: replay goes through the same
 *   services, so the same gate applies to a step that needs one.
 */
export const agentActions = sqliteTable(
	"agent_actions",
	{
		...standardColumns,

		/** The tool as declared, `domain.verb`. */
		toolName: text("tool_name").notNull(),
		/** The arguments as given, JSON. Shown to the person in full. */
		argsJson: text("args_json").notNull().default("{}"),
		/** One line a person reads before approving. Built when the action is made. */
		summary: text("summary").notNull(),

		/** pending, approved, rejected, expired, executed, failed. */
		state: text("state").notNull().default("pending"),

		/** mcp for an external agent, assistant for the in-app one, automation for a replay. */
		source: text("source").notNull().default("mcp"),
		/** The run this step belongs to, when an automation asked. */
		automationRunId: text("automation_run_id"),

		/** After this, approving is refused. A stale request is not a standing permission. */
		expiresAt: text("expires_at").notNull(),
		decidedAt: text("decided_at"),
		executedAt: text("executed_at"),

		/** What the service returned, JSON, once it ran. */
		resultJson: text("result_json"),
		error: text("error"),
	},
	(t) => [
		index("agent_actions_state_idx").on(t.state),
		index("agent_actions_run_idx").on(t.automationRunId),
		index("agent_actions_owner_idx").on(t.ownerId),
		index("agent_actions_deleted_idx").on(t.deletedAt),
	],
);

export const auditEvents = sqliteTable(
	"audit_events",
	{
		...standardColumns,

		/** user, agent or automation. What made the call, not who owns the data. */
		actor: text("actor").notNull(),
		toolName: text("tool_name").notNull(),
		/**
		 * SHA-256 of the canonical arguments, shortened. Two identical calls share
		 * a digest, which is what makes a retry recognisable, and no argument
		 * value is copied into the log.
		 */
		argsDigest: text("args_digest").notNull(),
		/** The same line the gate showed, so the log reads without the arguments. */
		summary: text("summary").notNull(),

		/** ok, failed, pending, rejected or expired. */
		result: text("result").notNull(),
		/** What the call touched, when the result says so. */
		entityType: text("entity_type"),
		entityId: text("entity_id"),
		/** The action this came from, for a call that went through the gate. */
		actionId: text("action_id"),
		error: text("error"),
	},
	(t) => [
		index("audit_events_created_idx").on(t.createdAt),
		index("audit_events_actor_idx").on(t.actor),
		index("audit_events_tool_idx").on(t.toolName),
		index("audit_events_entity_idx").on(t.entityType, t.entityId),
		index("audit_events_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A stored list of tool calls with a trigger.
 *
 * `steps_json` is an array of `{ tool, args }`. `trigger_json` is one of
 * `{ kind: "manual" }`, `{ kind: "daily", time }` or
 * `{ kind: "weekly", weekday, time }`, deliberately small for the same reason
 * phase 2's recurrence set is: a half-built scheduler is worse than none.
 */
export const automations = sqliteTable(
	"automations",
	{
		...standardColumns,

		name: text("name").notNull(),
		description: text("description"),
		triggerJson: text("trigger_json").notNull().default('{"kind":"manual"}'),
		stepsJson: text("steps_json").notNull().default("[]"),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

		lastRunAt: text("last_run_at"),
		/** The local date it last ran on, so a daily trigger fires once a day. */
		lastRunOn: text("last_run_on"),
	},
	(t) => [
		index("automations_enabled_idx").on(t.enabled),
		index("automations_owner_idx").on(t.ownerId),
		index("automations_deleted_idx").on(t.deletedAt),
	],
);

export const automationRuns = sqliteTable(
	"automation_runs",
	{
		...standardColumns,

		automationId: text("automation_id")
			.notNull()
			.references(() => automations.id),
		/** manual, schedule or agent. Who started this run. */
		startedBy: text("started_by").notNull().default("manual"),
		startedAt: text("started_at").notNull(),
		finishedAt: text("finished_at"),
		/** running, done, waiting, failed or cancelled. */
		status: text("status").notNull().default("running"),
		/** One entry per step: what ran, what came back, or why it stopped. */
		logJson: text("log_json").notNull().default("[]"),
		/** The step the run stopped on, when it is waiting or failed. */
		stoppedAtStep: integer("stopped_at_step"),
		error: text("error"),
	},
	(t) => [
		index("automation_runs_automation_idx").on(t.automationId, t.startedAt),
		index("automation_runs_status_idx").on(t.status),
		index("automation_runs_deleted_idx").on(t.deletedAt),
	],
);
