/**
 * What a drag of documents inside Juno carries. Rows put their ids on the
 * drag under a type of Juno's own, so a drop can tell them from files dragged
 * in from the operating system, which carry `Files`.
 */
export const DRAG_TYPE = "application/x-juno-explorer";

export type DragPayload = { kind: "documents"; ids: string[] };

export function encodeDrag(payload: DragPayload): string {
	return JSON.stringify(payload);
}

/** Reads a payload back, or null for anything that is not one of ours. */
export function decodeDrag(raw: string): DragPayload | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return null;
		const record = value as Record<string, unknown>;
		if (record["kind"] === "documents" && Array.isArray(record["ids"]) && record["ids"].every((id) => typeof id === "string")) {
			return { kind: "documents", ids: record["ids"] as string[] };
		}
		return null;
	} catch {
		return null;
	}
}
