import type { MailFolder, MailSpecialUse } from "@shared/types";

/** The folders every account has a version of, in the order people expect them. */
export const SPECIAL_ORDER: MailSpecialUse[] = ["inbox", "drafts", "sent", "archive", "junk", "trash"];

export const SPECIAL_LABELS: Record<MailSpecialUse, string> = {
	inbox: "Inbox",
	drafts: "Drafts",
	sent: "Sent",
	archive: "Archive",
	junk: "Junk",
	trash: "Trash",
};

export const SPECIAL_ICONS: Record<MailSpecialUse, "inbox" | "drafts" | "sent" | "archive" | "junk" | "remove"> = {
	inbox: "inbox",
	drafts: "drafts",
	sent: "sent",
	archive: "archive",
	junk: "junk",
	trash: "remove",
};

export type FolderNode = {
	folder: MailFolder;
	/** What the row says: the last segment of the path, not the whole path. */
	label: string;
	children: FolderNode[];
};

function delimiterOf(folders: MailFolder[]): string {
	return folders.find((folder) => folder.delimiter)?.delimiter ?? ".";
}

/**
 * The part of every path that is the server's own scaffolding.
 *
 * Some servers keep every folder inside the inbox, which is why this account's
 * paths read `INBOX.INBOX.Sent`. Showing that as written gives a sidebar where
 * everything is called INBOX-something. Only the inbox's own path counts as
 * scaffolding: any other shared prefix is a folder somebody made, and dropping
 * it would hide that these folders are grouped. It is a display decision, and
 * the path is untouched, because that is the server's address for the folder.
 */
export function commonPrefix(folders: MailFolder[], delimiter: string): string {
	const inbox = folders.find((folder) => folder.specialUse === "inbox");
	if (!inbox) return "";
	const others = folders.filter((folder) => folder.id !== inbox.id);
	if (others.length === 0) return "";
	const unit = `${inbox.path}${delimiter}`;
	// A step at a time, because this account's server does it twice: its paths
	// read INBOX.INBOX.Sent, so one pass would leave every label saying INBOX.
	let prefix = "";
	while (others.every((folder) => folder.path.startsWith(`${prefix}${unit}`))) prefix += unit;
	return prefix;
}

/**
 * The folders that are not one of the six, as a tree.
 *
 * A folder whose parent is not in the list, because the server lists a child
 * without listing what it hangs off, sits at the top with the missing part
 * still in its label. Hiding it would be worse: the folder exists, and mail in
 * it has to be reachable.
 */
export function buildFolderTree(folders: MailFolder[]): FolderNode[] {
	const delimiter = delimiterOf(folders);
	const prefix = commonPrefix(folders, delimiter);
	const custom = folders
		.filter((folder) => folder.specialUse === null)
		.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));

	const nodes = new Map<string, FolderNode>();
	const roots: FolderNode[] = [];

	for (const folder of custom) {
		let parent: FolderNode | null = null;
		let parentPath = "";
		for (const candidate of custom) {
			if (candidate.path === folder.path) continue;
			if (!folder.path.startsWith(`${candidate.path}${delimiter}`)) continue;
			if (candidate.path.length > parentPath.length) {
				parentPath = candidate.path;
				parent = nodes.get(candidate.path) ?? null;
			}
		}
		const label = parent
			? folder.path.slice(parent.folder.path.length + delimiter.length)
			: folder.path.startsWith(prefix)
				? folder.path.slice(prefix.length)
				: folder.path;
		const node: FolderNode = { folder, label: label || folder.name, children: [] };
		nodes.set(folder.path, node);
		if (parent) parent.children.push(node);
		else roots.push(node);
	}

	return roots;
}

/** The six, in order, with the label the sidebar uses. Only the ones that exist. */
export function specialFolders(folders: MailFolder[]): { folder: MailFolder; use: MailSpecialUse }[] {
	return SPECIAL_ORDER.flatMap((use) => {
		const folder = folders.find((f) => f.specialUse === use);
		return folder ? [{ folder, use }] : [];
	});
}

/** Every node of a tree, flattened, for a picker that needs one list. */
export function flattenTree(nodes: FolderNode[], depth = 0): { node: FolderNode; depth: number }[] {
	return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)]);
}
