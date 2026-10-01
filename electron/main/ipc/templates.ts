/**
 * Template channels. Thin, like every adapter: the rules live in
 * ../services/document-templates.ts.
 */
import { ipcMain } from "electron";
import type {
	DocumentCanvasRender,
	DocumentTemplateAssetInput,
	DocumentTemplateInput,
	DocumentTemplatePatch,
} from "../../shared/types";
import { pickDocx, previewTemplate, renderCanvasPdf, saveCanvasPdf } from "../services/document-actions";
import { importDocx } from "../services/document-docx";
import * as assets from "../services/document-template-assets";
import * as templates from "../services/document-templates";

export function registerTemplatesIpc(): void {
	ipcMain.handle("templates.list", () => templates.list());
	ipcMain.handle("templates.get", (_event, id: string) => templates.get(id));

	ipcMain.handle("templates.create", (_event, input: DocumentTemplateInput) =>
		templates.create(input),
	);

	ipcMain.handle("templates.update", (_event, id: string, patch: DocumentTemplatePatch) =>
		templates.update(id, patch),
	);

	ipcMain.handle("templates.setReviewed", (_event, id: string, reviewed: boolean) =>
		templates.setReviewed(id, reviewed),
	);

	ipcMain.handle("templates.remove", (_event, id: string) => templates.remove(id));

	ipcMain.handle(
		"templates.preview",
		(
			_event,
			input: {
				bodyHtml: string;
				clientId?: string | null;
				projectId?: string | null;
				isSpecimen: boolean;
			},
		) => previewTemplate(input),
	);

	ipcMain.handle("templates.renderPdf", (_event, input: DocumentCanvasRender) => renderCanvasPdf(input));
	ipcMain.handle("templates.savePdf", (_event, input: DocumentCanvasRender) => saveCanvasPdf(input));

	ipcMain.handle("templates.pickDocx", () => pickDocx());
	ipcMain.handle("templates.importDocx", (_event, input: { fileName: string; data: Uint8Array }) =>
		importDocx(input),
	);

	ipcMain.handle("templates.assets.list", (_event, templateId: string) => assets.list(templateId));
	ipcMain.handle("templates.assets.add", (_event, input: DocumentTemplateAssetInput) => assets.add(input));
	ipcMain.handle("templates.assets.remove", (_event, id: string) => assets.remove(id));
}
