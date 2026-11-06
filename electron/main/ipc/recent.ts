import { ipcMain } from "electron";
import type { RecentKind } from "../../shared/types";
import * as recent from "../services/recent";

export function registerRecentIpc(): void {
	ipcMain.handle("recent.list", () => recent.list());
	ipcMain.handle("recent.touch", (_event, kind: RecentKind, recordId: string) => {
		recent.touch(kind, recordId);
	});
	ipcMain.handle("recent.clear", () => recent.clear());
}
