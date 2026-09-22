/**
 * Agent channels. Thin: the rules live in ../services/agent-actions.ts,
 * ../services/agent-audit.ts, ../services/automations.ts and
 * ../services/briefing.ts.
 *
 * `agent.approve` is here and has no MCP tool, deliberately. It is the one
 * thing only a person may reach, and the window is the only caller of this
 * file (.claude/rules/mcp.md section 4, and decision 22 for the same shape in
 * the outbox).
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import type {
	AgentActionListQuery,
	AuditListQuery,
	AutomationInput,
	AutomationPatch,
	McpServerStatus,
} from "../../shared/types";
import * as actions from "../services/agent-actions";
import * as audit from "../services/agent-audit";
import * as automations from "../services/automations";
import * as briefing from "../services/briefing";
import { socketStatus, summaries, toolCount } from "../mcp";

/** Where the bridge lives, packaged or in the repo. */
function bridgePath(): string {
	return app.isPackaged
		? join(process.resourcesPath, "app.asar", "scripts", "mcp-bridge.mjs")
		: join(app.getAppPath(), "scripts", "mcp-bridge.mjs");
}

/**
 * The command an agent is configured with.
 *
 * The packaged app has no Node beside it, so its own binary runs the bridge as
 * plain Node, which is what ELECTRON_RUN_AS_NODE does. In development the host
 * Node is there and is simpler to read.
 */
function mcpStatus(userDataDir: string): McpServerStatus {
	const socket = socketStatus();
	const packaged = app.isPackaged;
	const command = packaged ? process.execPath : "node";
	const args = [bridgePath(), "--user-data-dir", userDataDir];
	const config = {
		mcpServers: {
			juno: {
				command,
				args,
				...(packaged ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}),
			},
		},
	};
	return {
		running: socket.running,
		address: socket.address,
		connections: socket.connections,
		command,
		args,
		configJson: JSON.stringify(config, null, "\t"),
		error: socket.error,
		toolCount: toolCount(),
	};
}

export function registerAgentIpc(userDataDir: string): void {
	ipcMain.handle("agent.status", () => mcpStatus(userDataDir));
	ipcMain.handle("agent.tools", () => summaries());
	ipcMain.handle("agent.revealConnectionFile", () =>
		shell.showItemInFolder(join(userDataDir, "mcp.json")),
	);

	ipcMain.handle("agent.actions.list", (_event, query?: AgentActionListQuery) =>
		actions.list(query ?? {}),
	);
	ipcMain.handle("agent.actions.get", (_event, id: string) => actions.get(id));
	ipcMain.handle("agent.actions.pendingCount", () => actions.pendingCount());
	// A person's press. There is no tool for this, and there will not be one.
	ipcMain.handle("agent.actions.approve", (_event, id: string) => actions.approve(id));
	ipcMain.handle("agent.actions.reject", (_event, id: string) => actions.reject(id));
	ipcMain.handle("agent.actions.remove", (_event, id: string) => actions.remove(id));

	ipcMain.handle("agent.audit.list", (_event, query?: AuditListQuery) => audit.list(query ?? {}));

	ipcMain.handle("automations.list", () => automations.list());
	ipcMain.handle("automations.get", (_event, id: string) => automations.get(id));
	ipcMain.handle("automations.create", (_event, input: AutomationInput) => automations.create(input));
	ipcMain.handle("automations.update", (_event, id: string, patch: AutomationPatch) =>
		automations.update(id, patch),
	);
	ipcMain.handle("automations.remove", (_event, id: string) => automations.remove(id));
	ipcMain.handle("automations.run", (_event, id: string) => automations.run(id, "manual"));
	ipcMain.handle("automations.runs", (_event, automationId?: string, limit?: number) =>
		automations.runs(automationId, limit),
	);
	ipcMain.handle("automations.cancelRun", (_event, runId: string) => automations.cancelRun(runId));

	// Pushed rather than polled, the same way the lock and the outbox are: a
	// request that appears while the person is on another screen has to reach
	// the badge without the screen asking.
	actions.onChange((action) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("agent.actionChanged", action);
		}
	});
	automations.onRunChange((run) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("agent.runChanged", run);
		}
	});

	ipcMain.handle("briefing.today", () => briefing.today());
	ipcMain.handle("briefing.client", (_event, clientId: string) => briefing.client(clientId));
	ipcMain.handle("briefing.month", (_event, month: string) => briefing.month(month));
}
