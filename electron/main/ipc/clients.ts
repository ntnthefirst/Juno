import { ipcMain } from "electron";
import type { ListClientsQuery } from "../../shared/api";
import type {
	ClientInput,
	ClientNoteInput,
	ClientNotePatch,
	ClientPatch,
	ClientTimelineQuery,
} from "../../shared/types";
import * as timeline from "../services/client-timeline";
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

	ipcMain.handle("clients.timeline", (_event, query: ClientTimelineQuery) => timeline.timeline(query));
	ipcMain.handle("clients.timelineCounts", (_event, clientId: string) =>
		timeline.timelineCounts(clientId),
	);

	ipcMain.handle("clientNotes.listForClient", (_event, clientId: string) =>
		timeline.listNotes(clientId),
	);
	ipcMain.handle("clientNotes.get", (_event, id: string) => timeline.getNote(id));
	ipcMain.handle("clientNotes.create", (_event, input: ClientNoteInput) => timeline.createNote(input));
	ipcMain.handle("clientNotes.update", (_event, id: string, patch: ClientNotePatch) =>
		timeline.updateNote(id, patch),
	);
	ipcMain.handle("clientNotes.remove", (_event, id: string) => timeline.removeNote(id));
	ipcMain.handle("clientNotes.restore", (_event, id: string) => timeline.restoreNote(id));
}
