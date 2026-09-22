import { ipcMain } from "electron";
import type { SearchQuery } from "../../shared/types";
import * as search from "../services/search";

export function registerSearchIpc(): void {
	ipcMain.handle("search.global", (_event, term: string, limit?: number) =>
		search.global(term, limit),
	);
	ipcMain.handle("search.query", (_event, input: SearchQuery) => search.query(input));
}
