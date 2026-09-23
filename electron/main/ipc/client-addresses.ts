import { ipcMain } from "electron";
import type { ClientAddressInput, ClientAddressPatch } from "../../shared/types";
import * as clientAddresses from "../services/client-addresses";

export function registerClientAddressesIpc(): void {
	ipcMain.handle("clientAddresses.listForClient", (_event, clientId: string) =>
		clientAddresses.listForClient(clientId),
	);
	ipcMain.handle("clientAddresses.create", (_event, input: ClientAddressInput) =>
		clientAddresses.create(input),
	);
	ipcMain.handle("clientAddresses.update", (_event, id: string, patch: ClientAddressPatch) =>
		clientAddresses.update(id, patch),
	);
	ipcMain.handle("clientAddresses.remove", (_event, id: string) => clientAddresses.remove(id));
	ipcMain.handle("clientAddresses.restore", (_event, id: string) => clientAddresses.restore(id));
	ipcMain.handle("clientAddresses.setPrimary", (_event, id: string) =>
		clientAddresses.setPrimary(id),
	);
}
