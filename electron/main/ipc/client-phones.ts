import { ipcMain } from "electron";
import type { ClientPhoneInput, ClientPhonePatch } from "../../shared/types";
import * as clientPhones from "../services/client-phones";

export function registerClientPhonesIpc(): void {
	ipcMain.handle("clientPhones.listForClient", (_event, clientId: string) =>
		clientPhones.listForClient(clientId),
	);
	ipcMain.handle("clientPhones.create", (_event, input: ClientPhoneInput) =>
		clientPhones.create(input),
	);
	ipcMain.handle("clientPhones.update", (_event, id: string, patch: ClientPhonePatch) =>
		clientPhones.update(id, patch),
	);
	ipcMain.handle("clientPhones.remove", (_event, id: string) => clientPhones.remove(id));
	ipcMain.handle("clientPhones.restore", (_event, id: string) => clientPhones.restore(id));
	ipcMain.handle("clientPhones.setPrimary", (_event, id: string) => clientPhones.setPrimary(id));
}
