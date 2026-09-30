import type { DocumentRecord } from "@shared/types";
import { messageOf } from "./errors";

/** True while a drag carries files from outside the window, not a row inside it. */
export function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export type ImportOutcome = {
	imported: DocumentRecord[];
	failures: { name: string; message: string }[];
};

/**
 * Imports dropped files for one client, one at a time.
 *
 * In order rather than in parallel, so two files with the same name in one drop
 * meet the duplicate rule the same way every time, and so a failure is reported
 * against the file that caused it. A file that fails does not stop the rest.
 *
 * The bytes are read here and sent over. The window never has a path to give:
 * a path from the renderer is exactly what the bridge is not allowed to take.
 */
export async function importFiles(clientId: string, files: File[]): Promise<ImportOutcome> {
	const outcome: ImportOutcome = { imported: [], failures: [] };
	for (const file of files) {
		if (!file.name.toLowerCase().endsWith(".pdf")) {
			outcome.failures.push({ name: file.name, message: `"${file.name}" is not a PDF.` });
			continue;
		}
		try {
			const data = new Uint8Array(await file.arrayBuffer());
			outcome.imported.push(
				await window.juno.documents.importBytes({ fileName: file.name, data, clientId }),
			);
		} catch (cause: unknown) {
			outcome.failures.push({ name: file.name, message: messageOf(cause) });
		}
	}
	return outcome;
}

const DOCUMENTS_CHANGED = "juno:documents-changed";

/**
 * Tells whatever is showing documents that the set changed, without remounting
 * it: a screen reloads its list and keeps the record the person had open.
 */
export function announceDocumentsChanged(): void {
	window.dispatchEvent(new Event(DOCUMENTS_CHANGED));
}

/** Runs `handler` whenever a drop or an import changed the documents. */
export function onDocumentsChanged(handler: () => void): () => void {
	window.addEventListener(DOCUMENTS_CHANGED, handler);
	return () => window.removeEventListener(DOCUMENTS_CHANGED, handler);
}
