import type { ImportSource, PickedPdf } from "@shared/types";

/** True while a drag carries files from outside the window, not a row inside it. */
export function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** One file waiting to be brought in, and the name to show while it waits. */
export type ImportItem = { label: string; source: ImportSource };

export type ImportOutcome = {
	documents: number;
	versions: number;
	skipped: number;
	failures: { name: string; message: string }[];
};

/**
 * Dropped files, read into the shape the import takes. A file that is not a PDF
 * is reported rather than sent, so a stray .txt in a drop costs nothing.
 *
 * The bytes are read here and sent over. The window never has a path to give:
 * a path from the renderer is exactly what the bridge is not allowed to take.
 */
export async function itemsFromFiles(files: File[]): Promise<{ items: ImportItem[]; rejected: string[] }> {
	const items: ImportItem[] = [];
	const rejected: string[] = [];
	for (const file of files) {
		if (!file.name.toLowerCase().endsWith(".pdf")) {
			rejected.push(`"${file.name}" is not a PDF.`);
			continue;
		}
		items.push({
			label: file.name,
			source: {
				kind: "bytes",
				fileName: file.name,
				data: new Uint8Array(await file.arrayBuffer()),
				fileDate: new Date(file.lastModified || Date.now()).toISOString(),
				via: "drop",
			},
		});
	}
	return { items, rejected };
}

export function itemsFromPicked(picked: PickedPdf[]): ImportItem[] {
	return picked.map((file) => ({
		label: file.fileName,
		source: { kind: "bytes", fileName: file.fileName, data: file.data, fileDate: file.fileDate, via: "picker" },
	}));
}

/** "2 documents imported, 1 version added." Past tense, one sentence. */
export function describeOutcome(outcome: ImportOutcome): string | null {
	const parts: string[] = [];
	if (outcome.documents > 0) parts.push(`${outcome.documents} ${outcome.documents === 1 ? "document" : "documents"} imported`);
	if (outcome.versions > 0) parts.push(`${outcome.versions} ${outcome.versions === 1 ? "version" : "versions"} added`);
	if (outcome.failures.length > 0) parts.push(`${outcome.failures.length} not brought in`);
	return parts.length > 0 ? `${parts.join(", ")}.`.replace(/^./, (first) => first.toUpperCase()) : null;
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
