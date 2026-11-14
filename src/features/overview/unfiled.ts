import type { DocumentRecord } from "@shared/types";

/** The documents kept under no client and no project, newest first: the ones the Overview asks a place for. */
export function unfiledOf(records: readonly DocumentRecord[]): DocumentRecord[] {
	return records
		.filter((record) => record.clientId === null && record.projectId === null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
