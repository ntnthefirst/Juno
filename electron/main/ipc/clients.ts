import { ipcMain } from "electron";
import type { ListClientsQuery } from "../../shared/api";
import type { ClientInput, ClientPatch } from "../../shared/types";
import * as clients from "../services/clients";

export function registerClientsIpc(): void {
	ipcMain.handle("clients.list", (_event, query?: ListClientsQuery) => clients.list(query));
	ipcMain.handle("clients.get", (_event, id: string) => clients.get(id));
	ipcMain.handle("clients.create", (_event, input: ClientInput) => clients.create(input));
	ipcMain.handle("clients.update", (_event, id: string, patch: ClientPatch) =>
		clients.update(id, patch),
	);
	ipcMain.handle("clients.remove", (_event, id: string) => clients.remove(id));
	ipcMain.handle("clients.restore", (_event, id: string) => clients.restore(id));
}
