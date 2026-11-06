import { ipcMain } from "electron";
import type { SuggestionSources } from "../../shared/types";
import * as suggestions from "../services/suggestions";

export function registerSuggestionsIpc(): void {
	ipcMain.handle("suggestions.forMessage", (_event, messageId: string) => suggestions.forMessage(messageId));
	ipcMain.handle("suggestions.dismiss", (_event, messageId: string, kind: string) =>
		suggestions.dismiss(messageId, kind),
	);
	ipcMain.handle("suggestions.accept", (_event, messageId: string, kind: string) =>
		suggestions.accept(messageId, kind),
	);
	ipcMain.handle("suggestions.sources.get", () => suggestions.getSources());
	ipcMain.handle("suggestions.sources.set", (_event, patch: Partial<SuggestionSources>) =>
		suggestions.setSources(patch),
	);
}
