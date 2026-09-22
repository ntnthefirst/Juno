import type { AgentActionState, AuditActor, AutomationStep } from "../../shared/types";
import * as actions from "../services/agent-actions";
import * as audit from "../services/agent-audit";
import * as automations from "../services/automations";
import * as briefing from "../services/briefing";
import type { ToolDescriptor } from "./types";

/**
 * Phase 6: the tools no single domain owned.
 *
 * Briefings answer a question across every domain at once. The action tools
 * let an agent see what became of a request it made. The automation tools
 * record and replay sequences of the other tools.
 *
 * **There is no tool that approves an action**, and there will not be, for the
 * same reason there is no `app.unlock`: the thing being gated is what would
 * call it. Approving is a person in the app
 * (.claude/rules/mcp.md section 4, PLAN.md section 4).
 */

const ACTION_STATES: AgentActionState[] = [
	"pending",
	"approved",
	"rejected",
	"expired",
	"executed",
	"failed",
];

const ACTORS: AuditActor[] = ["user", "agent", "automation"];

export const agentTools: ToolDescriptor[] = [
	{
		name: "briefing.today",
		title: "What needs attention today",
		description:
			"Everything due, scheduled or waiting, across reminders, the calendar, project deadlines, " +
			"the outbox and unreviewed documents. The headline is a sentence that can be read on its " +
			"own; every item carries the id of a record a person can open. This is the first call to " +
			"make when asked how things stand.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				date: { type: "string", description: "YYYY-MM-DD. Leave out for today on this machine." },
				timezone: { type: "string", description: "IANA zone the day is read in." },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			briefing.today(
				undefined,
				args.date ? String(args.date) : undefined,
				args.timezone ? String(args.timezone) : undefined,
			),
	},
	{
		name: "briefing.client",
		title: "Where a client stands",
		description:
			"One client's projects, open reminders, documents and mail in one answer. Use " +
			"search.global or clients.list first to turn a name into an id.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string" } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: async (args) => briefing.client(String(args.client_id)),
	},
	{
		name: "briefing.month",
		title: "What a month holds",
		description:
			"Paperwork due, project deadlines and calendar events for one month, in date order. " +
			"Answers questions like what is owed this month.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				month: { type: "string", description: "YYYY-MM, like 2026-03." },
				timezone: { type: "string", description: "IANA zone the dates are read in." },
			},
			required: ["month"],
			additionalProperties: false,
		},
		handler: async (args) =>
			briefing.month(
				String(args.month),
				undefined,
				undefined,
				args.timezone ? String(args.timezone) : undefined,
			),
	},
	{
		name: "agent.list_actions",
		title: "List the requests waiting for a person",
		description:
			"Requests that were parked for approval, newest first, with their state. A call that came " +
			"back pending is here until somebody answers it. Nothing here can be approved by a tool.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				states: { type: "array", items: { type: "string", enum: ACTION_STATES } },
				limit: { type: "integer", minimum: 1, maximum: 500 },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			actions.list({
				...(Array.isArray(args.states) ? { states: args.states as AgentActionState[] } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
			}),
	},
	{
		name: "agent.get_action",
		title: "Check one request",
		description:
			"What became of a request: still pending, rejected, expired, or executed with what the " +
			"service returned. Check here rather than asking for the same thing again.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => actions.get(String(args.id)),
	},
	{
		name: "audit.list",
		title: "Read the log of what was done",
		description:
			"Every call that changed something, newest first, with who made it and how it ended. " +
			"The arguments are not in the log; a digest of them is, so two identical calls can be " +
			"recognised.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				actor: { type: "string", enum: ACTORS },
				tool_name: { type: "string" },
				since: { type: "string", description: "UTC ISO-8601. Only events at or after this." },
				limit: { type: "integer", minimum: 1, maximum: 500 },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			audit.list({
				...(args.actor ? { actor: args.actor as AuditActor } : {}),
				...(args.tool_name ? { toolName: String(args.tool_name) } : {}),
				...(args.since ? { since: String(args.since) } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
			}),
	},
	{
		name: "automations.list",
		title: "List automations",
		description:
			"Stored sequences of tool calls, with their trigger and how the last run ended. An " +
			"automation is a recording, not a second engine: every step is one of these same tools.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => automations.list(),
	},
	{
		name: "automations.get",
		title: "Read an automation",
		description: "One automation with its steps and arguments in full.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => automations.get(String(args.id)),
	},
	{
		name: "automations.runs",
		title: "Read automation runs",
		description:
			"Past runs, newest first, each with a log of which steps ran and where it stopped. A run " +
			"that says waiting stopped on a step that needs a person.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				automation_id: { type: "string" },
				limit: { type: "integer", minimum: 1, maximum: 200 },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			automations.runs(
				args.automation_id ? String(args.automation_id) : undefined,
				args.limit !== undefined ? Number(args.limit) : undefined,
			),
	},
	{
		name: "automations.create",
		title: "Create an automation",
		description:
			"Records a sequence of tool calls. Each step is a tool name and its arguments, exactly as " +
			"they would be passed to that tool. A step that needs approval still needs it when the " +
			"automation runs: the run stops and waits for a person rather than going ahead.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				description: { type: ["string", "null"] },
				trigger: {
					type: "object",
					description:
						'One of {"kind":"manual"}, {"kind":"daily","time":"08:30"} or ' +
						'{"kind":"weekly","weekday":1,"time":"08:30"}. Weekday is 1 for Monday. Defaults to manual.',
				},
				steps: {
					type: "array",
					description: "The calls, in order.",
					items: {
						type: "object",
						properties: {
							tool: { type: "string" },
							args: { type: "object" },
						},
						required: ["tool"],
					},
				},
				enabled: { type: "boolean" },
			},
			required: ["name", "steps"],
			additionalProperties: false,
		},
		handler: async (args) =>
			automations.create({
				name: String(args.name),
				description: (args.description as string | null) ?? null,
				...(args.trigger ? { trigger: args.trigger as never } : {}),
				steps: (args.steps ?? []) as AutomationStep[],
				...(args.enabled !== undefined ? { enabled: args.enabled === true } : {}),
			}),
	},
	{
		name: "automations.update",
		title: "Edit an automation",
		description: "Changes an automation's name, description, trigger, steps or whether it is on.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				name: { type: "string" },
				description: { type: ["string", "null"] },
				trigger: { type: "object" },
				steps: { type: "array", items: { type: "object" } },
				enabled: { type: "boolean" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			automations.update(String(args.id), {
				...(args.name !== undefined ? { name: String(args.name) } : {}),
				...(args.description !== undefined ? { description: args.description as string | null } : {}),
				...(args.trigger !== undefined ? { trigger: args.trigger as never } : {}),
				...(args.steps !== undefined ? { steps: args.steps as AutomationStep[] } : {}),
				...(args.enabled !== undefined ? { enabled: args.enabled === true } : {}),
			}),
	},
	{
		name: "automations.run",
		title: "Run an automation now",
		description:
			"Runs the steps in order. Returns the run with its log. A step that needs approval stops " +
			"the run, which picks up from the next step once a person has answered.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => automations.run(String(args.id), "agent"),
	},
	{
		name: "automations.disable",
		title: "Turn an automation off",
		description: "Leaves it stored and stops it running. Turn it back on with automations.update.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => automations.setEnabled(String(args.id), false),
	},
	{
		name: "automations.delete",
		title: "Delete an automation",
		description: "Removes it. Past runs stay in the log.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => automations.remove(String(args.id)),
	},
];
