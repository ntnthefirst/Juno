import { describe, expect, it } from "vitest";
import type { MailBlock, MailColumns, MailContainer, MailNode } from "@shared/types";
import {
	canMoveInto,
	childrenOf,
	cloneBlock,
	cloneNode,
	cloneSection,
	colorsIn,
	duplicateNode,
	emptyLayout,
	emptySection,
	findCell,
	findNode,
	firstChildOf,
	insertNode,
	moveNode,
	moveWithinParent,
	newBlock,
	pairIds,
	parentOf,
	pathTo,
	removeNode,
	replaceColor,
	selectionIn,
	siblingOf,
	updateBlock,
	updateCell,
	updateColumns,
	updateSection,
} from "./canvas-actions";

/** A columns table with two cells, each empty, for tests that need one. */
function newColumns(name = "Columns"): MailColumns {
	return {
		id: crypto.randomUUID(),
		kind: "columns",
		hidden: false,
		name,
		alignSelf: "auto",
		grow: 0,
		gap: 12,
		box: {
			fill: null,
			padding: { top: 0, right: 0, bottom: 0, left: 0 },
			borderWidth: 0,
			borderColor: null,
			borderStyle: "solid",
			borderSides: { top: true, right: true, bottom: true, left: true },
			strokeHidden: false,
			borderRadius: 0,
			corners: null,
			opacity: 1,
			effects: [],
			width: null,
			minHeight: null,
			clip: false,
			customCss: null,
		},
		rows: [
			{
				id: crypto.randomUUID(),
				cells: [
					{ id: crypto.randomUUID(), width: 50, verticalAlign: "top", box: emptyBoxLike(), children: [] },
					{ id: crypto.randomUUID(), width: null, verticalAlign: "top", box: emptyBoxLike(), children: [] },
				],
			},
		],
	};
}

function emptyBoxLike() {
	return {
		fill: null,
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		borderWidth: 0,
		borderColor: null,
		borderStyle: "solid" as const,
		borderSides: { top: true, right: true, bottom: true, left: true },
		strokeHidden: false,
		borderRadius: 0,
		corners: null,
		opacity: 1,
		effects: [],
		width: null,
		minHeight: null,
		clip: false,
		customCss: null,
	};
}

/** A node known to be a container, for the tests that build one directly. */
function asSection(node: MailNode | undefined): MailContainer {
	return node as MailContainer;
}

/** A container nested inside the layout's own section, for tests that need real depth. */
function withNestedContainer() {
	const layout = emptyLayout();
	const outer = layout.children[0] as MailContainer;
	const inner = emptySection("Inner");
	const withInner = { ...layout, children: [{ ...outer, children: [inner] }] };
	return { layout: withInner, outerId: outer.id, innerId: inner.id };
}

function withColumns() {
	const layout = emptyLayout();
	const outer = layout.children[0] as MailContainer;
	const columns = newColumns();
	const withCols = { ...layout, children: [{ ...outer, children: [columns] }] };
	const firstCellId = columns.rows[0]!.cells[0]!.id;
	const secondCellId = columns.rows[0]!.cells[1]!.id;
	return { layout: withCols, outerId: outer.id, columnsId: columns.id, firstCellId, secondCellId };
}

describe("finding a node and its parent path", () => {
	it("finds a node at the top level and one nested inside a container", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		expect(findNode(layout, outerId)?.id).toBe(outerId);
		expect(findNode(layout, innerId)?.id).toBe(innerId);
		expect(findNode(layout, "missing")).toBeNull();
	});

	it("gives the path to a node, root first, not including the node itself", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		expect(pathTo(layout, outerId)).toEqual([]);
		expect(pathTo(layout, innerId)).toEqual([outerId]);
		expect(pathTo(layout, "missing")).toBeNull();
	});

	it("names the parent of a top-level node as null, and of a nested one by id", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		expect(parentOf(layout, outerId)).toBeNull();
		expect(parentOf(layout, innerId)).toBe(outerId);
		expect(parentOf(layout, "missing")).toBeUndefined();
	});

	it("finds a cell by id, and paths to a node inside one through the columns table and the cell", () => {
		const { layout, columnsId, firstCellId } = withColumns();
		const text = newBlock("text");
		const placed = insertNode(layout, firstCellId, text, null);
		expect(findCell(placed, firstCellId)?.id).toBe(firstCellId);
		expect(pathTo(placed, text.id)).toEqual([layout.children[0]!.id, columnsId, firstCellId]);
		expect(parentOf(placed, text.id)).toBe(firstCellId);
	});
});

describe("reading a parent's children", () => {
	it("reads the frame's own top level for null, and a container's or a cell's own for its id", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		expect(childrenOf(layout, null)?.map((node) => node.id)).toEqual([outerId]);
		expect(childrenOf(layout, outerId)?.map((node) => node.id)).toEqual([innerId]);
		expect(childrenOf(layout, "missing")).toBeNull();
	});

	it("steps into the first child of a container, a columns table, and a cell", () => {
		const { layout, innerId } = withNestedContainer();
		const outerId = layout.children[0]!.id;
		expect(firstChildOf(layout, outerId)).toBe(innerId);
		expect(firstChildOf(layout, innerId)).toBeNull();
		const { layout: withCols, columnsId, firstCellId } = withColumns();
		const text = newBlock("text");
		const placed = insertNode(withCols, firstCellId, text, null);
		expect(firstChildOf(placed, columnsId)).toBe(firstCellId);
		expect(firstChildOf(placed, firstCellId)).toBe(text.id);
	});
});

describe("inserting into a parent", () => {
	it("inserts into a container at the end, and straight after a named sibling", () => {
		const { layout, outerId } = withNestedContainer();
		const a = newBlock("text");
		const withA = insertNode(layout, outerId, a, null);
		const inner = asSection(withA.children[0]).children[0]!;
		expect(inner.id).not.toBe(a.id); // the existing Inner section is still first
		expect(asSection(withA.children[0]).children.map((node) => node.id)).toEqual([inner.id, a.id]);
		const b = newBlock("heading");
		const withB = insertNode(withA, outerId, b, inner.id);
		expect(asSection(withB.children[0]).children.map((node) => node.id)).toEqual([inner.id, b.id, a.id]);
	});

	it("inserts at the frame's own top level for a null parent", () => {
		const layout = emptyLayout();
		const section = emptySection("Second");
		const next = insertNode(layout, null, section, null);
		expect(next.children.map((node) => node.id)).toEqual([layout.children[0]!.id, section.id]);
	});

	it("inserts into a cell", () => {
		const { layout, firstCellId } = withColumns();
		const text = newBlock("text");
		const next = insertNode(layout, firstCellId, text, null);
		expect(findCell(next, firstCellId)?.children.map((node) => node.id)).toEqual([text.id]);
	});
});

describe("removing a node", () => {
	it("removes a nested node without touching its siblings", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		const a = newBlock("text");
		const withA = insertNode(layout, outerId, a, null);
		const next = removeNode(withA, innerId);
		expect(asSection(next.children[0]).children.map((node) => node.id)).toEqual([a.id]);
	});

	it("puts a section back when removing the last thing at the top level", () => {
		const layout = emptyLayout();
		const emptied = removeNode(layout, layout.children[0]!.id);
		expect(emptied.children).toHaveLength(1);
		expect((emptied.children[0] as MailContainer).children).toEqual([]);
		expect(emptied.children[0]!.id).not.toBe(layout.children[0]!.id);
	});

	it("leaves a cell alone: it is structural, not a node Delete takes on its own", () => {
		const { layout, firstCellId } = withColumns();
		expect(removeNode(layout, firstCellId)).toEqual(layout);
	});

	it("leaves an id nothing in the tree has alone", () => {
		const layout = emptyLayout();
		expect(removeNode(layout, "missing")).toEqual(layout);
	});
});

describe("moving a node between parents", () => {
	it("moves a block from one section into another", () => {
		const layout = emptyLayout();
		const a = newBlock("text");
		const withA = insertNode(layout, layout.children[0]!.id, a, null);
		const second = emptySection("Second");
		const twoSections = { ...withA, children: [...withA.children, second] };
		const moved = moveNode(twoSections, a.id, second.id, null);
		expect(asSection(moved.children[0]).children).toEqual([]);
		expect(asSection(moved.children[1]).children.map((node) => node.id)).toEqual([a.id]);
	});

	it("moves a container into another container, nesting it", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		const second = emptySection("Second");
		const withSecond = { ...layout, children: [...layout.children, second] };
		const moved = moveNode(withSecond, innerId, second.id, null);
		expect(asSection(moved.children[0]).children).toEqual([]);
		expect(asSection(moved.children[1]).children.map((node) => node.id)).toEqual([innerId]);
		void outerId;
	});

	it("moves a block into a cell", () => {
		const { layout, outerId, firstCellId } = withColumns();
		const text = newBlock("text");
		const withText = insertNode(layout, outerId, text, null);
		const moved = moveNode(withText, text.id, firstCellId, null);
		expect(findCell(moved, firstCellId)?.children.map((node) => node.id)).toEqual([text.id]);
	});

	it("refuses to move a container into itself", () => {
		const { layout, outerId } = withNestedContainer();
		expect(canMoveInto(layout, outerId, outerId)).toBe(false);
		expect(moveNode(layout, outerId, outerId, null)).toEqual(layout);
	});

	it("refuses to move a container into its own descendant", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		expect(canMoveInto(layout, outerId, innerId)).toBe(false);
		expect(moveNode(layout, outerId, innerId, null)).toEqual(layout);
	});

	it("refuses to move a container into a cell of its own columns table", () => {
		const { layout, outerId, columnsId, firstCellId } = withColumns();
		void columnsId;
		expect(canMoveInto(layout, outerId, firstCellId)).toBe(false);
	});

	it("refuses to nest a container past the depth the parser allows", () => {
		// The top-level section is one container; seven more nested one inside the
		// next reach the parser's own limit (MAX_DEPTH is 8 in
		// services/mail-layout.ts), so moving a spare container into the last one
		// has nowhere further to go, and into the one before it still fits.
		let layout = emptyLayout();
		let parentId = layout.children[0]!.id;
		let previousParentId = parentId;
		for (let i = 0; i < 7; i++) {
			const child = emptySection(`Level ${i}`);
			layout = insertNode(layout, parentId, child, null);
			previousParentId = parentId;
			parentId = child.id;
		}
		const spare = emptySection("Spare");
		layout = { ...layout, children: [...layout.children, spare] };
		expect(canMoveInto(layout, spare.id, previousParentId)).toBe(true);
		expect(canMoveInto(layout, spare.id, parentId)).toBe(false);
	});

	it("moves a block within its section and refuses to move it off either end", () => {
		const layout = emptyLayout();
		const sectionId = layout.children[0]!.id;
		const first = newBlock("text");
		const second = newBlock("heading");
		const withBlocks = insertNode(insertNode(layout, sectionId, first, null), sectionId, second, null);
		const moved = moveWithinParent(withBlocks, first.id, 1);
		expect(asSection(moved.children[0]).children.map((node) => node.id)).toEqual([second.id, first.id]);
		expect(moveWithinParent(withBlocks, first.id, -1)).toEqual(withBlocks);
		expect(moveWithinParent(moved, first.id, 1)).toEqual(moved);
	});
});

describe("stepping through the siblings of a parent", () => {
	it("goes round among the children of a container", () => {
		const layout = emptyLayout();
		const sectionId = layout.children[0]!.id;
		const first = newBlock("text");
		const second = newBlock("heading");
		const withBlocks = insertNode(insertNode(layout, sectionId, first, null), sectionId, second, null);
		expect(siblingOf(withBlocks, first.id, 1)).toBe(second.id);
		expect(siblingOf(withBlocks, second.id, 1)).toBe(first.id);
		expect(siblingOf(withBlocks, first.id, -1)).toBe(second.id);
	});

	it("goes round among top-level sections", () => {
		const layout = emptyLayout();
		const second = emptySection("Second");
		const withSecond = { ...layout, children: [...layout.children, second] };
		expect(siblingOf(withSecond, layout.children[0]!.id, 1)).toBe(second.id);
	});
});

describe("copying and duplicating", () => {
	it("gives a clone new ids all the way down, rows and cells included", () => {
		const { layout, columnsId, firstCellId } = withColumns();
		const text = newBlock("text");
		const placed = insertNode(layout, firstCellId, text, null);
		const columns = findNode(placed, columnsId) as MailNode & { kind: "columns" };
		const copy = cloneNode(columns);
		expect(copy.id).not.toBe(columnsId);
		expect(copy.kind).toBe("columns");
		if (copy.kind !== "columns") throw new Error("not columns");
		expect(copy.rows[0]!.id).not.toBe(columns.rows[0]!.id);
		expect(copy.rows[0]!.cells[0]!.id).not.toBe(columns.rows[0]!.cells[0]!.id);
		expect(copy.rows[0]!.cells[0]!.children[0]?.id).not.toBe(text.id);
		// A deep copy: changing the copy leaves the original as it was.
		const clonedText = copy.rows[0]!.cells[0]!.children[0] as MailBlock & { kind: "text" };
		clonedText.text.italic = true;
		expect((columns.rows[0]!.cells[0]!.children[0] as MailBlock & { kind: "text" }).text.italic).toBe(false);
	});

	it("pairs every id an original and its copy share a position for", () => {
		const section = emptySection("Body");
		const text = newBlock("text");
		const withText = { ...section, children: [text] };
		const copy = cloneNode(withText) as MailContainer;
		const pairs = pairIds(withText, copy);
		expect(pairs).toEqual([
			[withText.id, copy.id],
			[text.id, copy.children[0]!.id],
		]);
	});

	it("duplicates a node straight after the original, in the same parent", () => {
		const { layout, outerId, innerId } = withNestedContainer();
		const result = duplicateNode(layout, innerId);
		expect(result).not.toBeNull();
		const outer = result!.layout.children.find((node) => node.id === outerId) as MailContainer;
		expect(outer.children.map((node) => node.id)).toEqual([innerId, result!.id]);
		expect(result!.pairs[0]).toEqual([innerId, result!.id]);
	});

	it("refuses to duplicate a cell", () => {
		const { layout, firstCellId } = withColumns();
		expect(duplicateNode(layout, firstCellId)).toBeNull();
	});

	it("clones a block with a new id", () => {
		const block = newBlock("text");
		const copy = cloneBlock(block);
		expect(copy.id).not.toBe(block.id);
	});

	it("clones a section the same way cloneNode does", () => {
		const section = emptySection("Copy");
		const copy = cloneSection(section);
		expect(copy.id).not.toBe(section.id);
		expect(copy.kind).toBe("container");
	});
});

describe("editing a node anywhere in the tree", () => {
	it("patches a nested container", () => {
		const { layout, innerId } = withNestedContainer();
		const next = updateSection(layout, innerId, { name: "Renamed" });
		expect(findNode(next, innerId)?.kind === "container" ? (findNode(next, innerId) as MailContainer).name : null).toBe(
			"Renamed",
		);
	});

	it("patches a block inside a cell", () => {
		const { layout, firstCellId } = withColumns();
		const text = newBlock("text");
		const placed = insertNode(layout, firstCellId, text, null);
		const next = updateBlock(placed, text.id, { html: "Hallo" } as Partial<MailBlock>);
		const found = findNode(next, text.id);
		expect(found?.kind === "text" ? found.html : null).toBe("Hallo");
	});

	it("patches a columns table and a cell", () => {
		const { layout, columnsId, firstCellId } = withColumns();
		const next = updateCell(updateColumns(layout, columnsId, { name: "Renamed" }), firstCellId, { verticalAlign: "middle" });
		const columns = findNode(next, columnsId);
		expect(columns?.kind === "columns" ? columns.name : null).toBe("Renamed");
		expect(findCell(next, firstCellId)?.verticalAlign).toBe("middle");
	});
});

describe("what is still selected after an undo", () => {
	it("knows a top-level node, a nested one, and a cell", () => {
		const { layout, innerId } = withNestedContainer();
		expect(selectionIn(layout, innerId)).toBe(true);
		expect(selectionIn(layout, "missing")).toBe(false);
		expect(selectionIn(layout, null)).toBe(true);
		const columns = withColumns();
		expect(selectionIn(columns.layout, columns.firstCellId)).toBe(true);
	});
});

describe("selection colours across the tree", () => {
	it("finds a colour nested inside a container and inside a cell", () => {
		const { layout, innerId } = withNestedContainer();
		const styled = updateSection(layout, innerId, { box: { ...(findNode(layout, innerId) as MailContainer).box, borderWidth: 1, borderColor: "#4A3FA0" } });
		expect(colorsIn(styled, null)).toContain("#4a3fa0");
		expect(colorsIn(styled, innerId)).toEqual(["#4a3fa0"]);

		const { layout: withCols, firstCellId } = withColumns();
		const cell = findCell(withCols, firstCellId)!;
		const recellored = updateCell(withCols, firstCellId, { box: { ...cell.box, borderWidth: 1, borderColor: "#1F6A4D" } });
		expect(colorsIn(recellored, firstCellId)).toEqual(["#1f6a4d"]);
	});

	it("changes a colour inside a cell without touching the rest", () => {
		const { layout, firstCellId } = withColumns();
		const cell = findCell(layout, firstCellId)!;
		const styled = updateCell(layout, firstCellId, { box: { ...cell.box, borderWidth: 1, borderColor: "#4a3fa0" } });
		const next = replaceColor(styled, firstCellId, "#4a3fa0", "#1f6a4d");
		expect(findCell(next, firstCellId)?.box.borderColor).toBe("#1f6a4d");
	});
});
