/**
 * Starts the agent surface and ties its three halves together.
 *
 * - The gate runs an approved call by asking the registry for its handler.
 * - An automation step calls a tool the same way an agent does, gate included.
 * - An action that belongs to a waiting run pushes that run along once it is
 *   answered, which is what "the run waits" means in practice.
 *
 * The wiring is here rather than in each service because a service that
 * imported the registry would import every service through it. Injecting at
 * startup is the same shape the mailbox source, the transport and the PDF
 * renderer already use.
 */
import type { AgentActionSource } from "../../shared/types";
import * as actions from "../services/agent-actions";
import * as automations from "../services/automations";
import { callTool, executeApproved } from "./host";
import { toolByName } from "./registry";
import { startSocketServer, stopSocketServer, type SocketConfig } from "./socket";

export { listTools, callTool, summaries, toolCount } from "./host";
export { status as socketStatus } from "./socket";

let scheduler: NodeJS.Timeout | null = null;
let unsubscribe: (() => void) | null = null;

/** Checked every minute, so a trigger at 08:30 fires within the minute. */
const TICK_MS = 60_000;

export function startAgentSurface(config: SocketConfig): void {
	actions.configureAgentActions((tool, args) => executeApproved(tool, args));

	automations.configureAutomations({
		callTool: (tool, args, options) =>
			callTool(tool, args, {
				source: options.source as AgentActionSource,
				automationRunId: options.automationRunId,
			}),
		hasTool: (name) => toolByName(name) !== null,
	});

	// A run stopped on a step is picked up when that step is answered. Only the
	// states that end an action count: a pending one is still pending.
	unsubscribe?.();
	unsubscribe = actions.onChange((action) => {
		if (!action.automationRunId) return;
		if (action.state === "executed" || action.state === "failed" || action.state === "rejected" || action.state === "expired") {
			void automations.resumeForAction(action.id, action.state).catch(() => undefined);
		}
	});

	startSocketServer(config);
}

/**
 * Runs whatever a trigger says is due.
 *
 * Separate from the scheduler so a test can drive it with a fixed clock, the
 * same way the reminder notification is tested.
 */
export async function runDueAutomations(date: string, time: string): Promise<number> {
	const due = await automations.due(date, time);
	for (const automation of due) {
		// The same local date the trigger was matched against, so a run started
		// just after midnight cannot be stamped with yesterday.
		await automations.run(automation.id, "schedule", undefined, date).catch(() => undefined);
	}
	return due.length;
}

function localNow(): { date: string; time: string } {
	const at = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return {
		date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
		time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
	};
}

export function startAutomationScheduler(isPaused: () => boolean): void {
	if (scheduler) return;
	scheduler = setInterval(() => {
		// Nothing runs while locked. A timer is exactly the unattended case
		// decision 15 pauses, and an automation is not an exception to it.
		if (isPaused()) return;
		const { date, time } = localNow();
		void runDueAutomations(date, time).catch(() => undefined);
	}, TICK_MS);
}

export function stopAgentSurface(config?: SocketConfig): void {
	if (scheduler) clearInterval(scheduler);
	scheduler = null;
	unsubscribe?.();
	unsubscribe = null;
	stopSocketServer(config);
}
