/**
 * Template channels. Thin, like every adapter: the rules live in
 * ../services/document-templates.ts.
 */
import { ipcMain } from "electron";
import type {
	DetachInput,
	DocumentCanvasRender,
	DocumentComponentAssetInput,
	DocumentComponentInput,
	DocumentComponentPatch,
	DocumentComponentRender,
	DocumentTemplateAssetInput,
	DocumentTemplateInput,
	DocumentTemplatePatch,
} from "../../shared/types";
import { pickDocx, previewTemplate, renderCanvasPdf, renderComponentPdf, saveCanvasPdf } from "../services/document-actions";
import * as components from "../services/document-components";
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

	ipcMain.handle("templates.components.list", () => components.list());
	ipcMain.handle("templates.components.get", (_event, id: string) => components.get(id));
	ipcMain.handle("templates.components.create", (_event, input: DocumentComponentInput) => components.create(input));
	ipcMain.handle("templates.components.update", (_event, id: string, patch: DocumentComponentPatch) =>
		components.update(id, patch),
	);
	ipcMain.handle("templates.components.remove", (_event, id: string) => components.remove(id));
	ipcMain.handle("templates.components.usedBy", (_event, id: string) => components.usedBy(id));
	ipcMain.handle("templates.components.detach", (_event, input: DetachInput) => components.detach(input));
	ipcMain.handle("templates.components.renderPdf", (_event, input: DocumentComponentRender) =>
		renderComponentPdf(input),
	);
	ipcMain.handle("templates.components.assets.list", (_event, componentId: string) =>
		assets.listForComponent(componentId),
	);
	ipcMain.handle("templates.components.assets.add", (_event, input: DocumentComponentAssetInput) =>
		assets.addToComponent(input),
	);
	ipcMain.handle("templates.components.assets.remove", (_event, id: string) => assets.removeFromComponent(id));
}
