/**
 * Template channels. Thin, like every adapter: the rules live in
 * ../services/document-templates.ts.
 */
import { ipcMain } from "electron";
import type { DocumentTemplateInput, DocumentTemplatePatch } from "../../shared/types";
import { previewTemplate } from "../services/document-actions";
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
}
