/**
 * The one door every agent call goes through.
 *
 * It routes; it decides nothing about any domain. In order, a call is:
 *
 * 1. refused while Juno is locked, whatever it asks for (decision 15: the
 *    main process owns lock state and every tool checks it);
 * 2. matched to a declared tool, or refused by name;
 * 3. run, if the tool is read-only or a local write that needs no approval;
 * 4. parked in the confirmation gate, if it is anything that a person has to
 *    agree to first (.claude/rules/mcp.md section 4). The caller gets a
 *    pending action back, never a result.
 *
 * Step 4's enforcement lives in services/agent-actions.ts, not here, and the
 * one tool whose service holds its own gate says so in its declaration rather
 * than being special-cased in this file.
 *
 * A write that runs writes an audit row. Reads do not: a log of every list
 * call buries the one line that mattered.
 */
import type { AgentAction, AgentActionSource, ToolSummary } from "../../shared/types";
import * as actions from "../services/agent-actions";
import * as audit from "../services/agent-audit";
import { isLocked } from "../services/lock";
import { allTools, toolByName, toolSummaries } from "./registry";
import type { ToolDescriptor } from "./types";

export class ToolError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "ToolError";
		this.code = code;
	}
}

export interface ToolListing {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	readOnly: boolean;
	requiresConfirmation: boolean;
}

/**
 * What a gated call returns instead of a result.
 *
 * Shaped so an agent reading only the text still understands that nothing
 * happened yet and that a person has to act.
 */
export interface PendingResult {
	status: "pending";
	actionId: string;
	tool: string;
	summary: string;
	expiresAt: string;
	message: string;
}

export function listTools(): ToolListing[] {
	return allTools().map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: describe(tool),
		inputSchema: tool.inputSchema,
		readOnly: tool.readOnly,
		requiresConfirmation: tool.requiresConfirmation,
	}));
}

export function summaries(): ToolSummary[] {
	return toolSummaries();
}

export function toolCount(): number {
	return allTools().length;
}

/**
 * The declared description plus what the caller most needs to know: whether
 * this one comes back pending. An agent that learns that only by trying it
 * has already told a person it did something.
 */
function describe(tool: ToolDescriptor): string {
	if (tool.readOnly) return tool.description;
	if (tool.gatedInService) return tool.description;
	if (!tool.requiresConfirmation) return tool.description;
	return `${tool.description} Requires approval: this call does not run, it asks. A person approves or rejects it in Juno and the reply says pending.`;
}

const MAX_SUMMARY_VALUE = 60;

/** A compact, readable argument line. The whole object is shown in the app. */
function summarise(tool: ToolDescriptor, args: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null || value === "") continue;
		let rendered: string;
		if (typeof value === "string") rendered = value;
		else if (typeof value === "number" || typeof value === "boolean") rendered = String(value);
		else if (Array.isArray(value)) rendered = `${value.length} item${value.length === 1 ? "" : "s"}`;
		else rendered = "...";
		if (rendered.length > MAX_SUMMARY_VALUE) rendered = `${rendered.slice(0, MAX_SUMMARY_VALUE - 3)}...`;
		parts.push(`${key}: ${rendered}`);
		if (parts.length === 4) break;
	}
	return parts.length > 0 ? `${tool.title} (${parts.join(", ")})` : tool.title;
}

export interface CallOptions {
	source?: AgentActionSource;
	/** The automation run a step belongs to, so a stopped run can resume. */
	automationRunId?: string | null;
}

/**
 * Calls a tool as an agent would. Returns either the service's result or a
 * pending action, and the caller is expected to tell the two apart.
 */
export async function callTool(
	name: string,
	args: Record<string, unknown> = {},
	options: CallOptions = {},
): Promise<unknown> {
	if (isLocked()) {
		throw new ToolError(
			"JUNO_LOCKED",
			"Juno is locked. Unlock it on the machine; there is no tool that can.",
		);
	}

	const tool = toolByName(name);
	if (!tool) throw new ToolError("UNKNOWN_TOOL", `There is no tool called "${name}".`);

	const source = options.source ?? "mcp";

	if (!tool.readOnly && tool.requiresConfirmation && tool.gatedInService !== true) {
		const action = await actions.request({
			toolName: tool.name,
			args,
			summary: summarise(tool, args),
			source,
			automationRunId: options.automationRunId ?? null,
		});
		return pendingResultOf(action);
	}

	try {
		const result = await tool.handler(args);
		if (!tool.readOnly) {
			audit.record({
				actor: source === "automation" ? "automation" : "agent",
				toolName: tool.name,
				args,
				summary: summarise(tool, args),
				result: "ok",
				...entityOf(result),
			});
		}
		return result;
	} catch (cause: unknown) {
		const message = cause instanceof Error ? cause.message : String(cause);
		if (!tool.readOnly) {
			audit.record({
				actor: source === "automation" ? "automation" : "agent",
				toolName: tool.name,
				args,
				summary: summarise(tool, args),
				result: "failed",
				error: message,
			});
		}
		throw new ToolError("TOOL_FAILED", message);
	}
}

export function pendingResultOf(action: AgentAction): PendingResult {
	return {
		status: "pending",
		actionId: action.id,
		tool: action.toolName,
		summary: action.summary,
		expiresAt: action.expiresAt,
		message:
			"Nothing has happened yet. This is waiting for a person to approve it in Juno. " +
			"Check back with agent.get_action, and do not ask again in the meantime.",
	};
}

function entityOf(result: unknown): { entityId?: string } {
	if (!result || typeof result !== "object") return {};
	const id = (result as Record<string, unknown>).id;
	return typeof id === "string" ? { entityId: id } : {};
}

/**
 * Runs a tool's handler directly, with no gate.
 *
 * The only caller is the approval path in services/agent-actions.ts, which
 * reaches here after a person said yes. Nothing else may call it.
 */
export async function executeApproved(name: string, args: Record<string, unknown>): Promise<unknown> {
	const tool = toolByName(name);
	if (!tool) throw new ToolError("UNKNOWN_TOOL", `There is no tool called "${name}".`);
	return tool.handler(args);
}
