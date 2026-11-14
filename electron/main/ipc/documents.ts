/**
 * Document channels. Thin: generation lives in ../services/documents.ts and
 * everything that touches a PDF lives in ../services/document-actions.ts.
 */
import { basename } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type {
	CompareTextInput,
	AddVersionInput,
	AnalyseImportInput,
	DocumentFolderInput,
	DocumentFolderMove,
	DocumentMoveInput,
	DocumentPlace,
	FilePreviewSource,
	GenerateDocumentInput,
	ImportFileInput,
	ImportFromMailInput,
	SaveThreadAttachmentsInput,
	SignDocumentInput,
	VersionUse,
} from "../../shared/types";
import * as actions from "../services/document-actions";
import * as compare from "../services/document-compare";
import * as convert from "../services/document-convert";
import * as drag from "../services/document-drag";
import { onDocumentsChanged } from "../services/document-events";
import * as folders from "../services/document-folders";
import * as imports from "../services/document-import";
import * as fromMail from "../services/document-mail";
import * as organise from "../services/document-organise";
import * as timeline from "../services/document-timeline";
import * as versions from "../services/document-versions";
import * as working from "../services/document-working";
import * as documents from "../services/documents";
import * as preview from "../services/file-preview";

export function registerDocumentsIpc(): void {
	ipcMain.handle("documents.list", (_event, query?: { clientId?: string; projectId?: string }) =>
		documents.list(query ?? {}),
	);
	ipcMain.handle("documents.listUnfiled", () => documents.listUnfiled());
	ipcMain.handle("documents.listIn", (_event, place: DocumentPlace) => documents.listIn(place));
	ipcMain.handle("documents.move", (_event, id: string, input: DocumentMoveInput) => organise.move(id, input));
	ipcMain.handle("documents.rename", (_event, id: string, title: string) => organise.rename(id, title));
	ipcMain.handle("documents.duplicate", (_event, id: string) => organise.duplicate(id));
	ipcMain.handle("documents.copyTo", (_event, id: string, target: DocumentMoveInput) => organise.copyTo(id, target));
	ipcMain.handle("documents.convertPdf", (_event, id: string) => convert.convertToPdf(id));
	ipcMain.handle("documents.preview", (_event, source: FilePreviewSource) => preview.preview(source));
	ipcMain.handle("documents.open", (_event, id: string) => working.openDocument(id));
	// The platform's drag of the newest files, which only the window that is dragging can start.
	ipcMain.handle("documents.startDrag", async (event, ids: string[]) => {
		const files = await drag.dragFiles(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
		if (files.length === 0) return [];
		const icon = await app.getFileIcon(files[0]!, { size: "normal" });
		event.sender.startDrag({ file: files[0]!, files, icon });
		return files.map((file) => basename(file));
	});
	ipcMain.handle("documents.pickFiles", () => actions.pickFiles());
	ipcMain.handle("documents.importFromMail", (_event, input: ImportFromMailInput) => imports.importFromMail(input));
	ipcMain.handle("documents.threadAttachments", (_event, threadId: string) => fromMail.forThread(threadId));
	ipcMain.handle("documents.saveThreadAttachments", (_event, input: SaveThreadAttachmentsInput) =>
		fromMail.saveFromThread(input),
	);

	ipcMain.handle("documents.folders.tree", () => folders.tree());
	ipcMain.handle("documents.folders.create", (_event, input: DocumentFolderInput) => folders.create(input));
	ipcMain.handle("documents.folders.rename", (_event, id: string, name: string) => folders.rename(id, name));
	ipcMain.handle("documents.folders.move", (_event, id: string, target: DocumentFolderMove) => folders.move(id, target));
	ipcMain.handle("documents.folders.remove", (_event, id: string) => folders.remove(id));
	ipcMain.handle("documents.folders.restore", (_event, id: string) => folders.restore(id));

	// Pushed, because an edit saved in another app becomes a version while a
	// screen is open, and that screen did not ask for it.
	onDocumentsChanged((change) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("documents.changed", change);
		}
	});
	ipcMain.handle(
		"documents.link",
		(_event, id: string, input: { clientId: string | null; projectId: string | null }) => documents.link(id, input),
	);
	ipcMain.handle("documents.get", (_event, id: string) => working.getChecked(id));

	ipcMain.handle("documents.generate", (_event, input: GenerateDocumentInput) =>
		actions.generate(input),
	);

	ipcMain.handle("documents.pickPdfs", () => actions.pickPdfs());
	ipcMain.handle(
		"documents.analyseImport",
		(_event, input: AnalyseImportInput) => imports.analyseImport(input),
	);
	ipcMain.handle("documents.compareText", (_event, input: CompareTextInput) => compare.compareText(input));
	ipcMain.handle("documents.importFile", (_event, input: ImportFileInput) => imports.importFile(input));
	ipcMain.handle("documents.addVersion", (_event, input: AddVersionInput) => imports.addVersion(input));
	ipcMain.handle("documents.versions", (_event, documentId: string) => versions.list(documentId));
	ipcMain.handle("documents.openVersion", (_event, versionId: string) => actions.openVersion(versionId));
	ipcMain.handle("documents.openCertificate", (_event, versionId: string) => actions.openCertificate(versionId));
	ipcMain.handle("documents.readPdf", (_event, id: string) => actions.readPdf(id));
	ipcMain.handle("documents.readVersion", (_event, versionId: string) => actions.readVersion(versionId));
	ipcMain.handle("documents.downloadVersion", (_event, versionId: string) => actions.downloadVersion(versionId));
	ipcMain.handle("documents.confirmVersionUse", (_event, versionId: string, use: VersionUse) =>
		actions.confirmVersionUse(versionId, use),
	);
	ipcMain.handle("documents.deleteVersion", (_event, versionId: string) => actions.deleteVersion(versionId));
	ipcMain.handle("documents.timeline", (_event, documentId: string) => timeline.timeline(documentId));

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
}
