import type { DocumentFolderMove, DocumentMoveInput, DocumentRecord, DocumentTreeNode } from "@shared/types";

/**
 * The explorer's view of the tree the service hands over (decision 75). The
 * root is not a node of the service's: it is the explorer's own top, which
 * lists the nodes at the root as folders, the way a file manager's computer
 * view lists its drives.
 */
export const ROOT_KEY = "root";
export const TEMPLATES_KEY = "templates";
export const UNFILED_KEY = "unfiled";

/** The node with this key, anywhere in the tree. Null for the root and for a key that is gone. */
export function findNode(roots: readonly DocumentTreeNode[], key: string): DocumentTreeNode | null {
	for (const node of roots) {
		if (node.key === key) return node;
		const inside = findNode(node.children, key);
		if (inside) return inside;
	}
	return null;
}

/** The nodes from the root down to this one, itself last. Empty for the root or a key that is gone. */
export function pathTo(roots: readonly DocumentTreeNode[], key: string): DocumentTreeNode[] {
	for (const node of roots) {
		if (node.key === key) return [node];
		const below = pathTo(node.children, key);
		if (below.length > 0) return [node, ...below];
	}
	return [];
}

/** The node a document is drawn in: its folder, else its project, else its client, else Unfiled. */
export function keyOfRecord(record: Pick<DocumentRecord, "clientId" | "projectId" | "folderId">): string {
	if (record.folderId) return `folder:${record.folderId}`;
	if (record.projectId) return `project:${record.projectId}`;
	if (record.clientId) return `client:${record.clientId}`;
	return UNFILED_KEY;
}

/** Where a document moved or copied into this node is kept. Null for Templates, which keeps no documents. */
export function moveTargetOf(node: DocumentTreeNode): DocumentMoveInput | null {
	if (!node.place) return null;
	if (node.place.folderId) return { folderId: node.place.folderId };
	return { folderId: null, clientId: node.place.clientId, projectId: node.place.projectId };
}

/** Where a folder moved into this node sits. Null for Templates. */
export function folderTargetOf(node: DocumentTreeNode): DocumentFolderMove | null {
	if (!node.place) return null;
	if (node.folderId) return { parentId: node.folderId };
	return { parentId: null, clientId: node.place.clientId, projectId: node.place.projectId };
}

/** Whether `key` is this node or anywhere below it. */
export function holds(node: DocumentTreeNode, key: string): boolean {
	return node.key === key || node.children.some((child) => holds(child, key));
}

/** The node directly above this one, or null at the top. */
export function parentOf(roots: readonly DocumentTreeNode[], key: string): DocumentTreeNode | null {
	const path = pathTo(roots, key);
	return path.length >= 2 ? path[path.length - 2]! : null;
}

/** Documents in this node and everything below it, which is what a closed node's count says. */
export function countWithin(node: DocumentTreeNode): number {
	return node.children.reduce((total, child) => total + countWithin(child), node.documentCount);
}

/**
 * The rows the tree draws, top to bottom, with how deep each sits: a node's
 * children are listed only while it is open. This is what the arrow keys walk.
 */
export function visibleRows(
	roots: readonly DocumentTreeNode[],
	open: ReadonlySet<string>,
	depth = 0,
): { node: DocumentTreeNode; depth: number }[] {
	const rows: { node: DocumentTreeNode; depth: number }[] = [];
	for (const node of roots) {
		rows.push({ node, depth });
		if (open.has(node.key) && node.children.length > 0) rows.push(...visibleRows(node.children, open, depth + 1));
	}
	return rows;
}

/** "New folder", or the first "New folder 2", "New folder 3" not taken by a sibling. */
export function freeFolderName(siblings: readonly DocumentTreeNode[], wanted = "New folder"): string {
	const taken = new Set(siblings.map((node) => node.name.toLocaleLowerCase()));
	if (!taken.has(wanted.toLocaleLowerCase())) return wanted;
	for (let n = 2; ; n += 1) {
		const name = `${wanted} ${n}`;
		if (!taken.has(name.toLocaleLowerCase())) return name;
	}
}
