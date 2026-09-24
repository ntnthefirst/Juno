import { BrowserWindow, ipcMain } from "electron";
import type {
	ProjectAssetPatch,
	ProjectCommandInput,
	ProjectCommandPatch,
	ProjectInput,
	ProjectLinkInput,
	ProjectLinkPatch,
	ProjectPatch,
	ProjectStorageChoice,
} from "../../shared/types";
import * as actions from "../services/project-actions";
import * as assets from "../services/project-assets";
import * as commands from "../services/project-commands";
import * as links from "../services/project-links";
import * as runner from "../services/project-runner";
import * as projects from "../services/projects";
import type { ListProjectsQuery } from "../services/projects";

export function registerProjectsIpc(): void {
	ipcMain.handle("projects.list", (_event, query?: ListProjectsQuery) => projects.list(query));
	ipcMain.handle("projects.get", (_event, id: string) => projects.get(id));
	ipcMain.handle("projects.create", (_event, input: ProjectInput) => projects.create(input));
	ipcMain.handle("projects.update", (_event, id: string, patch: ProjectPatch) =>
		projects.update(id, patch),
	);
	ipcMain.handle("projects.remove", (_event, id: string) => projects.remove(id));
	ipcMain.handle("projects.restore", (_event, id: string) => projects.restore(id));

	ipcMain.handle("projects.storage", (_event, id: string) => projects.storage(id));
	ipcMain.handle("projects.setStorage", (_event, id: string, choice: ProjectStorageChoice) =>
		projects.setStorage(id, choice),
	);
	ipcMain.handle("projects.chooseStorageFolder", (_event, id: string, move: boolean) =>
		actions.chooseStorageFolder(id, move),
	);
	ipcMain.handle("projects.useAppStorage", (_event, id: string, move: boolean) =>
		actions.useAppStorage(id, move),
	);
	ipcMain.handle("projects.openStorageFolder", (_event, id: string) =>
		actions.openStorageFolder(id),
	);
	ipcMain.handle("projects.chooseLocalFolder", () => actions.chooseLocalFolder());
	ipcMain.handle("projects.openLocalFolder", (_event, id: string) => actions.openLocalFolder(id));
	ipcMain.handle("projects.setCover", (_event, id: string, assetId: string | null) =>
		projects.setCover(id, assetId),
	);

	ipcMain.handle("projects.links.list", (_event, projectId: string) =>
		links.listForProject(projectId),
	);
	ipcMain.handle("projects.links.create", (_event, input: ProjectLinkInput) => links.create(input));
	ipcMain.handle("projects.links.update", (_event, id: string, patch: ProjectLinkPatch) =>
		links.update(id, patch),
	);
	ipcMain.handle("projects.links.remove", (_event, id: string) => links.remove(id));
	ipcMain.handle("projects.links.reorder", (_event, projectId: string, orderedIds: string[]) =>
		links.reorder(projectId, orderedIds),
	);
	ipcMain.handle("projects.links.open", (_event, id: string) => actions.openLink(id));

	ipcMain.handle("projects.assets.list", (_event, projectId: string) =>
		assets.listForProject(projectId),
	);
	ipcMain.handle(
		"projects.assets.choose",
		(_event, projectId: string, storage: "managed" | "linked") =>
			actions.chooseAssets(projectId, storage),
	);
	ipcMain.handle("projects.assets.update", (_event, id: string, patch: ProjectAssetPatch) =>
		assets.update(id, patch),
	);
	ipcMain.handle("projects.assets.remove", (_event, id: string) => assets.remove(id));
	ipcMain.handle("projects.assets.restore", (_event, id: string) => assets.restore(id));
	ipcMain.handle("projects.assets.reorder", (_event, projectId: string, orderedIds: string[]) =>
		assets.reorder(projectId, orderedIds),
	);
	ipcMain.handle("projects.assets.open", (_event, id: string) => actions.openAsset(id));
	ipcMain.handle("projects.assets.reveal", (_event, id: string) => actions.revealAsset(id));

	// Commands and runs have no MCP counterpart, on purpose. A command runs in a
	// real shell with the user's own privileges, so writing one and running one
	// are the two halves of a remote shell. Decision 35, and
	// .claude/rules/mcp.md section 7. This channel is only reachable from the
	// window, which is a person at the keyboard.
	ipcMain.handle("projects.commands.list", (_event, projectId: string) =>
		commands.listForProject(projectId),
	);
	ipcMain.handle("projects.commands.create", (_event, input: ProjectCommandInput) =>
		commands.create(input),
	);
	ipcMain.handle("projects.commands.update", (_event, id: string, patch: ProjectCommandPatch) =>
		commands.update(id, patch),
	);
	ipcMain.handle("projects.commands.remove", (_event, id: string) => commands.remove(id));
	ipcMain.handle("projects.commands.reorder", (_event, projectId: string, orderedIds: string[]) =>
		commands.reorder(projectId, orderedIds),
	);

	ipcMain.handle("projects.runs.list", (_event, projectId?: string) => runner.list(projectId));
	ipcMain.handle("projects.runs.start", async (_event, commandId: string) =>
		runner.start(commands.requireCommandRow(commandId)),
	);
	ipcMain.handle("projects.runs.stop", (_event, commandId: string) => runner.stop(commandId));
	ipcMain.handle("projects.runs.clear", (_event, commandId: string) => runner.clear(commandId));

	// Output is pushed rather than polled, the same way mail sync is. A dev
	// server prints for as long as it runs, and a poll would either miss lines
	// or ask a hundred times a second for nothing.
	runner.onChange((run) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("projects.runChanged", run);
		}
	});
}
