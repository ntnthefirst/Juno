import { ipcMain } from "electron";
import type { ContactInput, ContactPatch } from "../../shared/types";
import * as contacts from "../services/contacts";

export function registerContactsIpc(): void {
	ipcMain.handle("contacts.listForClient", (_event, clientId: string) =>
		contacts.listForClient(clientId),
	);
	ipcMain.handle("contacts.create", (_event, input: ContactInput) => contacts.create(input));
	ipcMain.handle("contacts.update", (_event, id: string, patch: ContactPatch) =>
		contacts.update(id, patch),
	);
	ipcMain.handle("contacts.remove", (_event, id: string) => contacts.remove(id));
	ipcMain.handle("contacts.restore", (_event, id: string) => contacts.restore(id));
	ipcMain.handle("contacts.setPrimary", (_event, id: string) => contacts.setPrimary(id));
}
