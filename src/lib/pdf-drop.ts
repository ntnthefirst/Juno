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
 * Dropped files, read into the shape adding takes. Any kind of file is a
 * document (decision 75), so nothing is turned away here; the main process
 * checks what it is given and says why it refuses one.
 *
 * The bytes are read here and sent over. The window never has a path to give:
 * a path from the renderer is exactly what the bridge is not allowed to take.
 */
export async function itemsFromFiles(files: File[]): Promise<ImportItem[]> {
	const items: ImportItem[] = [];
	for (const file of files) {
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
	return items;
}

export function itemsFromPicked(picked: PickedPdf[]): ImportItem[] {
	return picked.map((file) => ({
		label: file.fileName,
		source: { kind: "bytes", fileName: file.fileName, data: file.data, fileDate: file.fileDate, via: "picker" },
	}));
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Said to files dropped or chosen while an earlier batch is still being added. */
export const BUSY_ADDING = "Finish adding the first files before adding more.";

/** "2 files added, 1 version added." Past tense, one sentence. */
export function describeOutcome(outcome: ImportOutcome, verb: "added" | "pasted" = "added"): string | null {
	const parts: string[] = [];
	if (outcome.documents > 0) parts.push(`${plural(outcome.documents, "file", "files")} ${verb}`);
	if (outcome.versions > 0) parts.push(`${plural(outcome.versions, "version", "versions")} added`);
	if (outcome.skipped > 0) parts.push(`${outcome.skipped} skipped`);
	if (outcome.failures.length > 0) parts.push(`${outcome.failures.length} not added`);
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
