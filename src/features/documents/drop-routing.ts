import type { DocumentFolderMove, DocumentMoveInput, DocumentPlace, DocumentTreeNode } from "@shared/types";
import { findNode, folderTargetOf, holds, moveTargetOf } from "./explorer-tree";

/**
 * What a drag inside the explorer carries. Rows and folders put their ids on
 * the drag under a type of Juno's own, so a drop can tell them from files
 * dragged in from the operating system, which carry `Files`.
 */
export const DRAG_TYPE = "application/x-juno-explorer";

export type DragPayload =
	| { kind: "documents"; ids: string[] }
	| { kind: "folder"; key: string; folderId: string };

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
		if (record["kind"] === "folder" && typeof record["key"] === "string" && typeof record["folderId"] === "string") {
			return { kind: "folder", key: record["key"], folderId: record["folderId"] };
		}
		return null;
	} catch {
		return null;
	}
}

export type DropRoute =
	| { kind: "add-files"; place: DocumentPlace }
	| { kind: "move-documents"; ids: string[]; target: DocumentMoveInput }
	| { kind: "move-folder"; folderId: string; target: DocumentFolderMove }
	/** Nothing happens. `reason` is worth saying when there is one. */
	| { kind: "none"; reason: string | null };

const UNFILED_PLACE: DocumentPlace = { clientId: null, projectId: null, folderId: null };

/**
 * Decides what a drop does, from what is dragged and where it lands.
 *
 * `target` is the tree node it was let go over, or the open node for a drop on
 * the content area; null is the explorer's own top, where files land in
 * Unfiled. `payload` is our own drag, decoded, or null for files from outside.
 */
export function routeDrop(input: {
	types: readonly string[];
	payload: DragPayload | null;
	target: DocumentTreeNode | null;
	roots: readonly DocumentTreeNode[];
}): DropRoute {
	const { payload, target } = input;

	if (!payload) {
		if (!input.types.includes("Files")) return { kind: "none", reason: null };
		if (!target) return { kind: "add-files", place: UNFILED_PLACE };
		if (!target.place) return { kind: "none", reason: "Templates holds templates. Drop files on a client, a project or a folder." };
		return { kind: "add-files", place: target.place };
	}

	if (!target) return { kind: "none", reason: null };

	if (payload.kind === "documents") {
		const move = moveTargetOf(target);
		if (!move) return { kind: "none", reason: "Templates holds templates, not documents." };
		if (payload.ids.length === 0) return { kind: "none", reason: null };
		return { kind: "move-documents", ids: payload.ids, target: move };
	}

	const dragged = findNode(input.roots, payload.key);
	if (dragged && holds(dragged, target.key)) {
		return target.key === payload.key ? { kind: "none", reason: null } : { kind: "none", reason: "A folder cannot go inside itself." };
	}
	const move = folderTargetOf(target);
	if (!move) return { kind: "none", reason: "Templates holds templates, not folders." };
	if (dragged && isDirectParent(input.roots, target.key, payload.key)) return { kind: "none", reason: null };
	return { kind: "move-folder", folderId: payload.folderId, target: move };
}

function isDirectParent(roots: readonly DocumentTreeNode[], parentKey: string, childKey: string): boolean {
	const parent = findNode(roots, parentKey);
	return parent ? parent.children.some((child) => child.key === childKey) : false;
}
