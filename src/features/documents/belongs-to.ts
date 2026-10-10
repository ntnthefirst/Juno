import type { DocumentRecord } from "@shared/types";

/**
 * What a document is kept under, as a list or a header shows it: the client,
 * the project, both, or nothing. Written the way reminders and calendar
 * entries already write it, "Client / Project".
 */
export function belongsTo(record: Pick<DocumentRecord, "clientName" | "projectName">): string {
	return [record.clientName, record.projectName].filter(Boolean).join(" / ") || "Not linked";
}
