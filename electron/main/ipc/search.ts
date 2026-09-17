import { ipcMain } from "electron";
import * as search from "../services/search";

export function registerSearchIpc(): void {
	ipcMain.handle("search.global", (_event, term: string, limit?: number) =>
		search.global(term, limit),
	);
}
