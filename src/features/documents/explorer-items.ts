import type { DocumentRecord } from "@shared/types";
import { fileTypeLabel } from "../../lib/file-type";

/**
 * One thing a list of files draws: a document. `key` is what the selection
 * holds.
 */
export type ExplorerItem = { kind: "document"; key: string; record: DocumentRecord };

export const documentKey = (id: string) => `doc:${id}`;

export function documentItem(record: DocumentRecord): ExplorerItem {
	return { kind: "document", key: documentKey(record.id), record };
}

/** The extra column of a list: where each document is kept, or which of the client's projects it is under. */
export type WhereColumn = "where" | "project";

/** The project a client's document is kept under, or nothing for one of the client's own. */
export function projectOf(item: ExplorerItem): string {
	return item.record.projectName ?? "";
}

export type SortColumn = "name" | "type" | "size" | "modified";
export type ExplorerSort = { by: SortColumn; descending: boolean };

export const DEFAULT_SORT: ExplorerSort = { by: "name", descending: false };

/** The Type column. A page and a document with no file yet say so rather than naming a format. */
export function typeOf(item: ExplorerItem): string {
	const { record } = item;
	if (record.sourceKind === "page") return "Page";
	if (!record.latestVersion) return "No file yet";
	return fileTypeLabel(record.latestVersion.fileName, record.latestVersion.mediaType);
}

/** In bytes. Null for a page and a version kept before sizes were recorded. */
export function sizeOf(item: ExplorerItem): number | null {
	return item.record.latestVersion?.byteSize ?? null;
}

/** When it last changed: the newest file's own date, or the record's when it has no file. */
export function modifiedOf(item: ExplorerItem): string | null {
	return item.record.latestVersion?.fileDate ?? item.record.updatedAt;
}

export function nameOf(item: ExplorerItem): string {
	return item.record.title;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * In the order of the column chosen. A tie falls back to the name and then
 * the key, so two files of one size do not swap places on every reload.
 */
export function sortItems(items: readonly ExplorerItem[], sort: ExplorerSort): ExplorerItem[] {
	const direction = sort.descending ? -1 : 1;
	const byName = (a: ExplorerItem, b: ExplorerItem) => collator.compare(nameOf(a), nameOf(b)) || a.key.localeCompare(b.key);
	const compare = (a: ExplorerItem, b: ExplorerItem): number => {
		if (sort.by === "type") return collator.compare(typeOf(a), typeOf(b)) || byName(a, b);
		if (sort.by === "size") {
			const sa = sizeOf(a) ?? -1;
			const sb = sizeOf(b) ?? -1;
			return sa - sb || byName(a, b);
		}
		if (sort.by === "modified") return (modifiedOf(a) ?? "").localeCompare(modifiedOf(b) ?? "") || byName(a, b);
		return byName(a, b);
	};
	return [...items].sort((a, b) => compare(a, b) * direction);
}

/** Clicking a column header: the same column turns the order round, another starts it the natural way. */
export function nextSort(current: ExplorerSort, by: SortColumn): ExplorerSort {
	if (current.by === by) return { by, descending: !current.descending };
	return { by, descending: by === "modified" || by === "size" };
}

/** A document's row matches a search when its title, its client, its project or its file name has the words. */
export function matchesSearch(record: DocumentRecord, needle: string): boolean {
	const words = needle.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = [record.title, record.clientName ?? "", record.projectName ?? "", record.latestVersion?.fileName ?? ""]
		.join(" ")
		.toLocaleLowerCase();
	return words.every((word) => haystack.includes(word));
}
