import { describe, expect, it } from "vitest";
import type { DocumentTreeNode } from "@shared/types";
import {
	countWithin,
	findNode,
	folderTargetOf,
	freeFolderName,
	keyOfRecord,
	moveTargetOf,
	parentOf,
	pathTo,
	visibleRows,
} from "./explorer-tree";
import { decodeDrag, encodeDrag, routeDrop } from "./drop-routing";

function node(partial: Partial<DocumentTreeNode> & Pick<DocumentTreeNode, "key" | "kind" | "name">): DocumentTreeNode {
	return {
		place: { clientId: null, projectId: null, folderId: null },
		documentCount: 0,
		folderId: null,
		clientId: null,
		projectId: null,
		children: [],
		...partial,
	};
}

const contracts = node({
	key: "folder:f1",
	kind: "folder",
	name: "Contracts",
	folderId: "f1",
	clientId: "c1",
	place: { clientId: "c1", projectId: null, folderId: "f1" },
	documentCount: 2,
	children: [
		node({
			key: "folder:f2",
			kind: "folder",
			name: "Signed",
			folderId: "f2",
			clientId: "c1",
			place: { clientId: "c1", projectId: null, folderId: "f2" },
			documentCount: 1,
		}),
	],
});
const kitchen = node({
	key: "project:p1",
	kind: "project",
	name: "Kitchen",
	clientId: "c1",
	projectId: "p1",
	place: { clientId: "c1", projectId: "p1", folderId: null },
	documentCount: 3,
});
const jansen = node({
	key: "client:c1",
	kind: "client",
	name: "Jansen",
	clientId: "c1",
	place: { clientId: "c1", projectId: null, folderId: null },
	documentCount: 1,
	children: [kitchen, contracts],
});
const unfiled = node({ key: "unfiled", kind: "unfiled", name: "Unfiled", documentCount: 4 });
const templates = node({ key: "templates", kind: "templates", name: "Templates", place: null });
const ROOTS = [jansen, unfiled, templates];

describe("the tree", () => {
	it("finds a node at any depth, and the path down to it", () => {
		expect(findNode(ROOTS, "folder:f2")?.name).toBe("Signed");
		expect(pathTo(ROOTS, "folder:f2").map((n) => n.name)).toEqual(["Jansen", "Contracts", "Signed"]);
		expect(parentOf(ROOTS, "folder:f2")?.key).toBe("folder:f1");
		expect(parentOf(ROOTS, "client:c1")).toBeNull();
		expect(findNode(ROOTS, "folder:gone")).toBeNull();
		expect(pathTo(ROOTS, "root")).toEqual([]);
	});

	it("names the node a document is drawn in, most specific first", () => {
		expect(keyOfRecord({ clientId: "c1", projectId: "p1", folderId: "f1" })).toBe("folder:f1");
		expect(keyOfRecord({ clientId: "c1", projectId: "p1", folderId: null })).toBe("project:p1");
		expect(keyOfRecord({ clientId: "c1", projectId: null, folderId: null })).toBe("client:c1");
		expect(keyOfRecord({ clientId: null, projectId: null, folderId: null })).toBe("unfiled");
	});

	it("turns a node into where a document or a folder goes", () => {
		expect(moveTargetOf(contracts)).toEqual({ folderId: "f1" });
		expect(moveTargetOf(kitchen)).toEqual({ folderId: null, clientId: "c1", projectId: "p1" });
		expect(moveTargetOf(templates)).toBeNull();
		expect(folderTargetOf(contracts)).toEqual({ parentId: "f1" });
		expect(folderTargetOf(unfiled)).toEqual({ parentId: null, clientId: null, projectId: null });
	});

	it("counts what is inside a node, all the way down", () => {
		expect(countWithin(jansen)).toBe(1 + 3 + 2 + 1);
	});

	it("lists only the children of open nodes", () => {
		expect(visibleRows(ROOTS, new Set()).map((row) => row.node.key)).toEqual(["client:c1", "unfiled", "templates"]);
		const open = visibleRows(ROOTS, new Set(["client:c1", "folder:f1"]));
		expect(open.map((row) => `${row.depth}:${row.node.name}`)).toEqual([
			"0:Jansen",
			"1:Kitchen",
			"1:Contracts",
			"2:Signed",
			"0:Unfiled",
			"0:Templates",
		]);
	});

	it("finds a free name for a new folder", () => {
		expect(freeFolderName([])).toBe("New folder");
		expect(freeFolderName([node({ key: "a", kind: "folder", name: "new folder" })])).toBe("New folder 2");
	});
});

describe("routeDrop", () => {
	it("adds files from outside to the node they land on, and to Unfiled at the top", () => {
		expect(routeDrop({ types: ["Files"], payload: null, target: kitchen, roots: ROOTS })).toEqual({
			kind: "add-files",
			place: { clientId: "c1", projectId: "p1", folderId: null },
		});
		expect(routeDrop({ types: ["Files"], payload: null, target: null, roots: ROOTS })).toEqual({
			kind: "add-files",
			place: { clientId: null, projectId: null, folderId: null },
		});
	});

	it("refuses files on Templates, with a reason", () => {
		const route = routeDrop({ types: ["Files"], payload: null, target: templates, roots: ROOTS });
		expect(route.kind).toBe("none");
		expect(route.kind === "none" && route.reason).toBeTruthy();
	});

	it("ignores a drag that carries neither files nor rows", () => {
		expect(routeDrop({ types: ["text/plain"], payload: null, target: kitchen, roots: ROOTS })).toEqual({ kind: "none", reason: null });
	});

	it("moves rows into a folder or a place", () => {
		expect(routeDrop({ types: [], payload: { kind: "documents", ids: ["d1"] }, target: contracts, roots: ROOTS })).toEqual({
			kind: "move-documents",
			ids: ["d1"],
			target: { folderId: "f1" },
		});
	});

	it("moves a folder, but never into itself or below itself", () => {
		const dragged = { kind: "folder" as const, key: "folder:f1", folderId: "f1" };
		expect(routeDrop({ types: [], payload: dragged, target: unfiled, roots: ROOTS })).toEqual({
			kind: "move-folder",
			folderId: "f1",
			target: { parentId: null, clientId: null, projectId: null },
		});
		const below = routeDrop({ types: [], payload: dragged, target: findNode(ROOTS, "folder:f2"), roots: ROOTS });
		expect(below.kind).toBe("none");
		expect(below.kind === "none" && below.reason).toBeTruthy();
		expect(routeDrop({ types: [], payload: dragged, target: contracts, roots: ROOTS })).toEqual({ kind: "none", reason: null });
		// Dropped where it already is: nothing to do, nothing to say.
		expect(routeDrop({ types: [], payload: dragged, target: jansen, roots: ROOTS })).toEqual({ kind: "none", reason: null });
	});

	it("reads back only payloads of its own shape", () => {
		const payload = { kind: "documents" as const, ids: ["a", "b"] };
		expect(decodeDrag(encodeDrag(payload))).toEqual(payload);
		expect(decodeDrag("not json")).toBeNull();
		expect(decodeDrag(JSON.stringify({ kind: "documents", ids: [1] }))).toBeNull();
		expect(decodeDrag(JSON.stringify({ kind: "other" }))).toBeNull();
	});
});
