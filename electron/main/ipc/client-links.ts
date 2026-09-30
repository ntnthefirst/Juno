import { ipcMain } from "electron";
import type { ClientLinkInput, ClientLinkPatch } from "../../shared/types";
import * as clientLinkActions from "../services/client-link-actions";
import * as clientLinks from "../services/client-links";

export function registerClientLinksIpc(): void {
	ipcMain.handle("clientLinks.listForClient", (_event, clientId: string) =>
		clientLinks.listForClient(clientId),
	);
	ipcMain.handle("clientLinks.create", (_event, input: ClientLinkInput) => clientLinks.create(input));
	ipcMain.handle("clientLinks.update", (_event, id: string, patch: ClientLinkPatch) =>
		clientLinks.update(id, patch),
	);
	ipcMain.handle("clientLinks.remove", (_event, id: string) => clientLinks.remove(id));
	ipcMain.handle("clientLinks.restore", (_event, id: string) => clientLinks.restore(id));
	ipcMain.handle("clientLinks.open", (_event, id: string) => clientLinkActions.open(id));
}
