import { ipcMain } from "electron";
import * as desktop from "../services/desktop";
import type { DesktopPatch } from "../../shared/types";

export function registerDesktopIpc(): void {
	ipcMain.handle("desktop.get", () => desktop.getView());
	ipcMain.handle("desktop.update", (_event, patch: DesktopPatch) => desktop.update(patch));
}
