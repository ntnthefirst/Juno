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
import { BrowserWindow, ipcMain } from "electron";
import type {
	AgentActionListQuery,
	AuditListQuery,
	AutomationInput,
	AutomationPatch,
} from "../../shared/types";
import * as actions from "../services/agent-actions";
import * as audit from "../services/agent-audit";
import * as describe from "../services/agent-describe";
import * as connections from "../services/agent-connections";
import * as automations from "../services/automations";
import * as briefing from "../services/briefing";
import * as clientInstall from "../services/agent-install";
import { serverStatus, setServerEnabled, setServerPort, summaries } from "../mcp";
import { getMainWindow, getSettingsWindow } from "../windows";

/**
 * A client started the handshake, and whoever is looking at Juno has to see the
 * prompt. The settings window is modal, so while it is open it is the only
 * window that takes input, and it carries the prompt itself.
 */
function bringForward(): void {
	const window = getSettingsWindow() ?? getMainWindow();
	if (!window) return;
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
	window.flashFrame(true);
}

export function registerAgentIpc(): void {
	ipcMain.handle("agent.server.status", () => serverStatus());
	ipcMain.handle("agent.server.setEnabled", (_event, enabled: boolean) => setServerEnabled(enabled === true));
	ipcMain.handle("agent.server.setPort", (_event, port: number | null) => setServerPort(port));
	ipcMain.handle("agent.install.targets", () => clientInstall.targets());
	ipcMain.handle("agent.install.write", (_event, clientId: string) => clientInstall.install(clientId));
	ipcMain.handle("agent.tools", () => summaries());

	// Letting a client in is a person's decision. These have no tool, and there
	// will not be one: the thing being gated is what would call it.
	ipcMain.handle("agent.connections.list", () => connections.list());
	ipcMain.handle("agent.connections.revoke", (_event, id: string) => connections.revoke(id));
	ipcMain.handle("agent.connections.createToken", (_event, name: string) => connections.createToken(name));
	ipcMain.handle("agent.pairing.list", () => connections.listPairings());
	ipcMain.handle("agent.pairing.answer", (_event, id: string, code: string) =>
		connections.answerPairing(id, code),
	);
	ipcMain.handle("agent.pairing.deny", (_event, id: string) => connections.denyPairing(id));

	// Pushed, because a request arrives while somebody is on another screen. The
	// listing is read again on the other end, so the event carries nothing.
	connections.onChange(() => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("agent.connectionsChanged");
		}
	});
	connections.onPairingRequested(() => bringForward());

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

	// What a request or a log row is, in words: the records it names instead of
	// their ids. Reads only.
	const titleOf = (toolName: string) => summaries().find((tool) => tool.name === toolName)?.title ?? toolName;
	ipcMain.handle("agent.actions.describe", async (_event, ids: string[]) => {
		const rows = (await Promise.all(ids.map((id) => actions.get(id)))).filter((row) => row !== null);
		return describe.describeActions(rows, titleOf);
	});
	ipcMain.handle("agent.audit.describe", async (_event, ids: string[]) => {
		const wanted = new Set(ids);
		const rows = (await audit.list({ limit: 500 })).filter((row) => wanted.has(row.id));
		return describe.describeAudit(rows, titleOf);
	});

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
