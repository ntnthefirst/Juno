/**
 * Starts the agent surface and ties its halves together.
 *
 * - The server is switched on and off here, and restarted when its port moves.
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
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentActionSource, McpServerStatus } from "../../shared/types";
import * as actions from "../services/agent-actions";
import * as connections from "../services/agent-connections";
import * as automations from "../services/automations";
import { isLocked } from "../services/lock";
import * as settings from "../services/settings";
import { callTool, executeApproved, listTools, toolCount } from "./host";
import { httpServerStatus, startHttpServer, stopHttpServer } from "./http-server";
import { toolByName } from "./registry";

export { listTools, callTool, summaries, toolCount } from "./host";

export interface AgentSurfaceConfig {
	userDataDir: string;
	/** What the port is when nobody picked one. A development run uses its own, so both can be open. */
	defaultPort: number;
	/** Reported to clients as the server's version. */
	version: string;
	/** Let the system pick the port. For a run that must not meet an installed Juno. */
	ephemeralPort?: boolean;
}

let config: AgentSurfaceConfig | null = null;

/** Switching on, off and moving the port run one after another, never over each other. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Files an earlier design left in the user data folder: the pipe's address and
 * token, its tool cache and the marker that told its bridge to leave during an
 * update. Nothing reads them now, and one of them holds a token.
 */
const LEFTOVERS = ["mcp.json", "mcp-tools.json", "mcp.sock", "updating"];

function removeLeftovers(dir: string): void {
	for (const name of LEFTOVERS) {
		try {
			rmSync(join(dir, name), { force: true });
		} catch {
			// A file that cannot be removed is a file nothing reads.
		}
	}
}

let scheduler: NodeJS.Timeout | null = null;
let unsubscribe: (() => void) | null = null;

/** Checked every minute, so a trigger at 08:30 fires within the minute. */
const TICK_MS = 60_000;

export async function startAgentSurface(next: AgentSurfaceConfig): Promise<void> {
	config = next;
	connections.configureAgentConnections(next.userDataDir);
	removeLeftovers(next.userDataDir);

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

	await applyServer();
}

/** The server as the settings say it should be: listening, or not. */
function applyServer(): Promise<McpServerStatus> {
	const run = queue.then(async () => {
		if (!config) throw new Error("startAgentSurface has not been called.");
		await stopHttpServer();
		const stored = await settings.getMcpServer();
		if (stored.enabled) {
			const port = config.ephemeralPort ? 0 : (stored.port ?? config.defaultPort);
			await startHttpServer(port, {
				listTools,
				callTool: (name, args) => callTool(name, args, { source: "mcp" }),
				isLocked,
				version: config.version,
			});
		}
		return serverStatus();
	});
	// A failure must not poison the queue for the next change.
	queue = run.catch(() => undefined);
	return run;
}

export async function serverStatus(): Promise<McpServerStatus> {
	if (!config) throw new Error("startAgentSurface has not been called.");
	const stored = await settings.getMcpServer();
	const http = httpServerStatus();
	const port = http.running ? http.port : (stored.port ?? config.defaultPort);
	return {
		enabled: stored.enabled,
		running: http.running,
		port,
		defaultPort: config.defaultPort,
		url: `http://127.0.0.1:${port}/mcp`,
		error: stored.enabled ? http.error : null,
		toolCount: toolCount(),
	};
}

/** The switch. Off stops the listener and drops every open request; who was let in is kept. */
export async function setServerEnabled(enabled: boolean): Promise<McpServerStatus> {
	await settings.setMcpServer({ enabled });
	return applyServer();
}

/** A port of the person's choosing, or null for the default. Restarts the listener on it. */
export async function setServerPort(port: number | null): Promise<McpServerStatus> {
	await settings.setMcpServer({ port });
	return applyServer();
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

export function stopAgentSurface(): void {
	if (scheduler) clearInterval(scheduler);
	scheduler = null;
	unsubscribe?.();
	unsubscribe = null;
	void stopHttpServer();
}
