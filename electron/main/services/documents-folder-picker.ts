import { dialog } from "electron";
import type { DocumentsFolder } from "../../shared/types";
import * as documentsFolder from "./documents-folder";

/**
 * Asks for a folder in a dialog in the main process and keeps it. The renderer
 * never supplies a path, for the reason the signature picker does not take one:
 * a path from a page is a path an injected script could aim anywhere.
 * Returns null when the dialog is cancelled, which is not an error.
 */
export async function choose(): Promise<DocumentsFolder | null> {
	const result = await dialog.showOpenDialog({
		title: "Choose a documents folder",
		properties: ["openDirectory", "createDirectory"],
	});
	if (result.canceled || result.filePaths.length === 0) return null;
	return documentsFolder.set(result.filePaths[0]!);
}
