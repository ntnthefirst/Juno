import { ipcMain } from "electron";
import type { ClientEmailInput, ClientEmailPatch } from "../../shared/types";
import * as clientEmails from "../services/client-emails";

export function registerClientEmailsIpc(): void {
	ipcMain.handle("clientEmails.listForClient", (_event, clientId: string) =>
		clientEmails.listForClient(clientId),
	);
	ipcMain.handle("clientEmails.create", (_event, input: ClientEmailInput) =>
		clientEmails.create(input),
	);
	ipcMain.handle("clientEmails.update", (_event, id: string, patch: ClientEmailPatch) =>
		clientEmails.update(id, patch),
	);
	ipcMain.handle("clientEmails.remove", (_event, id: string) => clientEmails.remove(id));
	ipcMain.handle("clientEmails.restore", (_event, id: string) => clientEmails.restore(id));
	ipcMain.handle("clientEmails.setPrimary", (_event, id: string) => clientEmails.setPrimary(id));
}
