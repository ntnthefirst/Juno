/**
 * IPC for reference data. Unwraps arguments, calls one service function, returns
 * its result. No logic lives here, by decision 2.
 *
 * Channel names match the path in shared/api.ts exactly, so a handler and the
 * call that reaches it can be found by the same grep.
 */
import { ipcMain } from "electron";
import type {
	ReferenceItemInput,
	ReferenceItemPatch,
	ReferenceSetKey,
	ResetUserItems,
} from "../../shared/types";
import * as reference from "../services/reference";

export function registerReferenceIpc(): void {
	ipcMain.handle("reference.listSets", () => reference.listSets());
	ipcMain.handle("reference.getSet", (_event, key: ReferenceSetKey) => reference.getSet(key));
	ipcMain.handle("reference.createItem", (_event, input: ReferenceItemInput) =>
		reference.createItem(input),
	);
	ipcMain.handle("reference.updateItem", (_event, id: string, patch: ReferenceItemPatch) =>
		reference.updateItem(id, patch),
	);
	ipcMain.handle("reference.hideItem", (_event, id: string) => reference.hideItem(id));
	ipcMain.handle("reference.unhideItem", (_event, id: string) => reference.unhideItem(id));
	ipcMain.handle("reference.usage", (_event, id: string) => reference.usage(id));
	ipcMain.handle("reference.reorder", (_event, setId: string, orderedIds: string[]) =>
		reference.reorder(setId, orderedIds),
	);
	ipcMain.handle("reference.resetSet", (_event, key: ReferenceSetKey, userItems: ResetUserItems) =>
		reference.resetSet(key, userItems),
	);
	ipcMain.handle("reference.resetAll", (_event, userItems: ResetUserItems) =>
		reference.resetAll(userItems),
	);
}
