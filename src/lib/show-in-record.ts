import type { DocumentRecord } from "@shared/types";
import { requestOpenClient } from "./open-client";
import { requestOpen, type TemplatesPlace } from "./open-entity";

/**
 * Shows a document where it is kept: on its project's Documents tab when it
 * has a project, otherwise on its client's, previewed there. A document kept
 * under neither is previewed over the screen in view.
 */
export function showDocumentWhereKept(record: DocumentRecord): void {
	if (record.projectId) {
		requestOpen({ kind: "project", id: record.projectId, name: record.projectName ?? "Project", tab: "documents", documentId: record.id });
		return;
	}
	if (record.clientId) {
		requestOpenClient(record.clientId, record.clientName ?? "Client", { tab: "documents", documentId: record.id });
		return;
	}
	requestOpen({ kind: "document", id: record.id, name: record.title });
}

/** Back to the client or project the Templates screen was opened from, on its Documents tab. */
export function showPlace(place: TemplatesPlace): void {
	if (place.projectId) requestOpen({ kind: "project", id: place.projectId, name: place.name, tab: "documents" });
	else if (place.clientId) requestOpenClient(place.clientId, place.name, { tab: "documents" });
}
