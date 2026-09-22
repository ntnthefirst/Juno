/**
 * Document channels. Thin: generation lives in ../services/documents.ts and
 * everything that touches a PDF lives in ../services/document-actions.ts.
 */
import { ipcMain } from "electron";
import type { GenerateDocumentInput, ImportDocumentInput, SignDocumentInput } from "../../shared/types";
import * as actions from "../services/document-actions";
import * as documents from "../services/documents";

export function registerDocumentsIpc(): void {
	ipcMain.handle("documents.list", (_event, query?: { clientId?: string }) =>
		documents.list(query ?? {}),
	);
	ipcMain.handle("documents.get", (_event, id: string) => documents.get(id));

	ipcMain.handle("documents.generate", (_event, input: GenerateDocumentInput) =>
		documents.generate(input),
	);

	ipcMain.handle("documents.import", (_event, input: ImportDocumentInput) => documents.importPdf(input));
	ipcMain.handle("documents.chooseImport", (_event, clientId: string) => actions.chooseImportPdf(clientId));

	ipcMain.handle("documents.setStatus", (_event, id: string, statusId: string | null) =>
		documents.setStatus(id, statusId),
	);

	ipcMain.handle("documents.remove", (_event, id: string) => documents.remove(id));
	ipcMain.handle("documents.restore", (_event, id: string) => documents.restore(id));

	ipcMain.handle("documents.previewHtml", (_event, id: string) => actions.previewHtml(id));
	ipcMain.handle("documents.renderPdf", (_event, id: string) => actions.renderPdf(id));

	ipcMain.handle("documents.sign", (_event, input: SignDocumentInput) => actions.sign(input));
	ipcMain.handle("documents.signatures", (_event, id: string) => actions.signatures(id));

	ipcMain.handle("documents.openPdf", (_event, id: string) => actions.openPdf(id));
	ipcMain.handle("documents.revealPdf", (_event, id: string) => actions.revealPdf(id));
}
