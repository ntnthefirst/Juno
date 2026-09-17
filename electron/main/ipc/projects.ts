import { ipcMain } from "electron";
import type { ProjectInput, ProjectPatch } from "../../shared/types";
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
}
