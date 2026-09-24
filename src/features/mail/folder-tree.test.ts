import { describe, expect, it } from "vitest";
import type { MailFolder, MailSpecialUse } from "@shared/types";
import { buildFolderTree, commonPrefix, flattenTree, specialFolders } from "./folder-tree";

function folder(path: string, specialUse: MailSpecialUse | null = null, delimiter = "."): MailFolder {
	return {
		id: path,
		ownerId: "owner",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		accountId: "account",
		path,
		name: path.split(delimiter).pop() ?? path,
		delimiter,
		specialUse,
		syncEnabled: true,
		messageCount: 0,
		unreadCount: 0,
		lastSyncAt: null,
	};
}

describe("the folder tree", () => {
	it("nests a folder under the folder it lives in", () => {
		const tree = buildFolderTree([
			folder("INBOX", "inbox"),
			folder("Facturen"),
			folder("Facturen.2026"),
			folder("Facturen.2026.Q1"),
		]);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.label).toBe("Facturen");
		expect(tree[0]?.children[0]?.label).toBe("2026");
		expect(tree[0]?.children[0]?.children[0]?.label).toBe("Q1");
	});

	it("drops the prefix a server puts on everything", () => {
		// This account's own server keeps every folder under the inbox, and does
		// it twice: the real paths read INBOX.INBOX.Sent. One pass would leave
		// every label in the sidebar saying INBOX-something.
		const folders = [
			folder("INBOX", "inbox"),
			folder("INBOX.INBOX.Sent", "sent"),
			folder("INBOX.INBOX.Trash", "trash"),
			folder("INBOX.INBOX.Facturen"),
			folder("INBOX.INBOX.Facturen.2026"),
		];

		expect(commonPrefix(folders, ".")).toBe("INBOX.INBOX.");
		const tree = buildFolderTree(folders);
		expect(tree[0]?.label).toBe("Facturen");
		expect(tree[0]?.children[0]?.label).toBe("2026");
	});

	it("keeps the missing part in the label when a parent is not listed", () => {
		// The folder is real and the mail in it has to be reachable, so it goes at
		// the top with its path intact rather than being dropped.
		const tree = buildFolderTree([folder("INBOX", "inbox"), folder("Klanten.Jansen")]);

		expect(tree).toHaveLength(1);
		expect(tree[0]?.label).toBe("Klanten.Jansen");
	});

	it("leaves a shared prefix alone when it is a folder somebody made", () => {
		// Klanten is a real folder people grouped things under, even when the
		// server does not list it. Stripping it would hide the grouping.
		expect(
			commonPrefix([folder("INBOX", "inbox"), folder("Klanten.Jansen"), folder("Klanten.Peeters")], "."),
		).toBe("");
	});

	it("lists the special folders in the order people expect, and only the ones there", () => {
		const found = specialFolders([
			folder("Trash", "trash"),
			folder("INBOX", "inbox"),
			folder("Sent", "sent"),
			folder("Facturen"),
		]);

		expect(found.map((entry) => entry.use)).toEqual(["inbox", "sent", "trash"]);
	});

	it("flattens with a depth per row", () => {
		const flat = flattenTree(buildFolderTree([folder("A"), folder("A.B"), folder("C")]));

		expect(flat.map((row) => [row.node.label, row.depth])).toEqual([
			["A", 0],
			["B", 1],
			["C", 0],
		]);
	});
});
