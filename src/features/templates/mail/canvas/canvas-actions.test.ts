import { describe, expect, it } from "vitest";
import type { MailBlock, MailColumns, MailContainer, MailNode } from "@shared/types";
import {
	addCell,
	addRow,
	asListItems,
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
	insertTarget,
	locateCell,
	moveNode,
	moveWithinParent,
	nameFor,
	newBlock,
	newColumns as makeColumns,
	pairIds,
	parentOf,
	pathTo,
	removeCell,
	removeNode,
	removeRow,
	replaceColor,
	safeLink,
	selectionIn,
	setContainerTag,
	setTextTag,
	siblingOf,
	updateBlock,
	updateCell,
	updateColumns,
	updateSection,
} from "./canvas-actions";
import { newElement, type ElementId } from "./elements";

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
			margin: { top: 0, right: 0, bottom: 0, left: 0 },
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
		margin: { top: 0, right: 0, bottom: 0, left: 0 },
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

describe("adding every element of the toolbar", () => {
	const kinds: Record<string, string> = {
		section: "container",
		div: "container",
		header: "container",
		footer: "container",
		main: "container",
		article: "container",
		aside: "container",
		nav: "container",
		h1: "heading",
		h2: "heading",
		h3: "heading",
		h4: "heading",
		h5: "heading",
		h6: "heading",
		p: "text",
		blockquote: "text",
		pre: "text",
		address: "text",
		span: "text",
		ul: "text",
		ol: "text",
		columns: "columns",
		image: "image",
		"linked-image": "image",
		divider: "divider",
		field: "field",
	};

	it("makes exactly the HTML element it names", () => {
		const layout = emptyLayout();
		for (const [id, kind] of Object.entries(kinds)) {
			const node = newElement(layout, id as ElementId);
			expect(node.kind).toBe(kind);
			if (node.kind === "container" || node.kind === "heading" || node.kind === "text") expect(node.tag).toBe(id);
		}
	});

	it("makes a list with one item, and a heading, a text and a picture that say something", () => {
		const layout = emptyLayout();
		const list = newElement(layout, "ol");
		expect(list.kind === "text" ? list.html : "").toBe("<li>Punt</li>");
		const heading = newElement(layout, "h4");
		expect(heading.kind === "heading" ? heading.content : "").toBe("Titel");
		const text = newElement(layout, "blockquote");
		expect(text.kind === "text" ? text.html : "").toBe("Tekst");
	});

	it("makes a linked picture with an empty link, and a plain one with none", () => {
		const layout = emptyLayout();
		const linked = newElement(layout, "linked-image");
		const plain = newElement(layout, "image");
		expect(linked.kind === "image" ? linked.href : "x").toBe("");
		expect(plain.kind === "image" ? plain.href : "x").toBeNull();
	});

	it("makes columns of one row and two cells, each holding a text", () => {
		const node = newElement(emptyLayout(), "columns");
		if (node.kind !== "columns") throw new Error("not columns");
		expect(node.rows).toHaveLength(1);
		expect(node.rows[0]?.cells).toHaveLength(2);
		expect(node.rows[0]?.cells.map((cell) => cell.width)).toEqual([50, 50]);
		expect(node.rows[0]?.cells.every((cell) => cell.children.length === 1 && cell.children[0]?.kind === "text")).toBe(true);
	});

	it("makes a rule that takes no share of the room", () => {
		const rule = newElement(emptyLayout(), "divider");
		expect(rule.kind === "divider" ? rule.grow : 1).toBe(0);
	});

	it("tells containers of the same tag apart in the layers", () => {
		let layout = emptyLayout();
		const first = newElement(layout, "header");
		layout = insertNode(layout, null, first, null);
		const second = newElement(layout, "header");
		expect((first as MailContainer).name).toBe("Header");
		expect((second as MailContainer).name).toBe("Header 2");
		expect(nameFor(layout, "Body")).toBe("Body 2");
	});
});

describe("where a new element lands", () => {
	function scene() {
		const layout = emptyLayout();
		const first = layout.children[0] as MailContainer;
		const text = newBlock("text");
		const withText = insertNode(layout, first.id, text, null);
		const columns = makeColumns(withText);
		const withColumns = insertNode(withText, null, columns, null);
		return { layout: withColumns, first, text, columns, cell: columns.rows[0]!.cells[0]! };
	}

	it("goes inside the selected container, at the end", () => {
		const { layout, first } = scene();
		expect(insertTarget(layout, first.id, false)).toEqual({ parentId: first.id, afterId: null });
		expect(insertTarget(layout, first.id, true)).toEqual({ parentId: first.id, afterId: null });
	});

	it("goes inside the selected cell, at the end", () => {
		const { layout, cell } = scene();
		expect(insertTarget(layout, cell.id, false)).toEqual({ parentId: cell.id, afterId: null });
	});

	it("goes straight after the selected block or columns table, in its own parent", () => {
		const { layout, first, text, columns } = scene();
		expect(insertTarget(layout, text.id, false)).toEqual({ parentId: first.id, afterId: text.id });
		expect(insertTarget(layout, columns.id, false)).toEqual({ parentId: null, afterId: columns.id });
	});

	it("puts a container or columns at the top level when nothing is selected, and anything else in the last container", () => {
		const { layout, first } = scene();
		expect(insertTarget(layout, null, true)).toEqual({ parentId: null, afterId: null });
		expect(insertTarget(layout, null, false)).toEqual({ parentId: first.id, afterId: null });
	});

	it("skips a hidden container, and a selection inside one", () => {
		const { layout, first, text } = scene();
		const hidden = updateSection(layout, first.id, { hidden: true });
		expect(insertTarget(hidden, text.id, false)).toEqual({ parentId: first.id, afterId: null });
		// Nothing shows to land in, so the top level is all there is.
		const onlyHidden = { ...hidden, children: hidden.children.filter((node) => node.kind === "container") };
		expect(insertTarget(onlyHidden, null, false)).toEqual({ parentId: first.id, afterId: null });
		const shown = insertNode(hidden, null, { ...emptySection("Two"), id: "two" }, null);
		expect(insertTarget(shown, null, false)).toEqual({ parentId: "two", afterId: null });
	});

	it("goes to the frame when the frame has no container", () => {
		const layout = { ...emptyLayout(), children: [newBlock("text")] };
		expect(insertTarget(layout, null, false)).toEqual({ parentId: null, afterId: null });
	});
});

describe("changing a tag within its group", () => {
	function withText(html: string, tag: "p" | "ul" | "ol" | "span" | "blockquote" = "p") {
		const layout = emptyLayout();
		const section = layout.children[0] as MailContainer;
		const block = newBlock("text");
		if (block.kind !== "text") throw new Error("not text");
		const text: MailBlock = { ...block, tag, html };
		return { layout: insertNode(layout, section.id, text, null), id: text.id };
	}

	function read(layout: ReturnType<typeof emptyLayout>, id: string): MailBlock {
		const found = findNode(layout, id);
		if (!found || found.kind === "container" || found.kind === "columns") throw new Error("not a block");
		return found;
	}

	it("changes a container's tag and keeps everything in it", () => {
		const layout = emptyLayout();
		const section = layout.children[0] as MailContainer;
		const inner = newBlock("text");
		const filled = insertNode(layout, section.id, inner, null);
		for (const tag of ["div", "header", "footer", "main", "article", "aside", "nav", "section"] as const) {
			const next = setContainerTag(filled, section.id, tag);
			const changed = findNode(next, section.id) as MailContainer;
			expect(changed.tag).toBe(tag);
			expect(changed.children).toHaveLength(1);
			expect(changed.id).toBe(section.id);
		}
	});

	it("renames a container that still has its tag's name, and leaves a name somebody chose", () => {
		let layout = emptyLayout();
		const header = newElement(layout, "header") as MailContainer;
		layout = insertNode(layout, null, header, null);
		const asDiv = setContainerTag(layout, header.id, "div");
		expect((findNode(asDiv, header.id) as MailContainer).name).toBe("Div");
		const named = updateSection(layout, header.id, { name: "Voorpagina" });
		expect((findNode(setContainerTag(named, header.id, "footer"), header.id) as MailContainer).name).toBe("Voorpagina");
	});

	it("changes a text between text tags with its words intact", () => {
		const { layout, id } = withText("Dag <b>Jan</b>");
		for (const tag of ["blockquote", "pre", "address", "span", "p"] as const) {
			const block = read(setTextTag(layout, id, tag), id);
			expect(block.kind === "text" ? block.tag : null).toBe(tag);
			expect(block.kind === "text" ? block.html : null).toBe("Dag <b>Jan</b>");
		}
	});

	it("turns lines into list items and list items back into lines", () => {
		const { layout, id } = withText("Een<br>Twee<br><br>Drie");
		const asList = read(setTextTag(layout, id, "ul"), id);
		expect(asList.kind === "text" ? asList.html : null).toBe("<li>Een</li><li>Twee</li><li>Drie</li>");
		const back = read(setTextTag(setTextTag(layout, id, "ol"), id, "p"), id);
		expect(back.kind === "text" ? back.html : null).toBe("Een<br>Twee<br>Drie");
		// A list to a list keeps its items as they are.
		const sameKind = read(setTextTag(setTextTag(layout, id, "ul"), id, "ol"), id);
		expect(sameKind.kind === "text" ? sameKind.html : null).toBe("<li>Een</li><li>Twee</li><li>Drie</li>");
	});

	it("turns a text into a heading of plain words, and a heading into a text of escaped ones", () => {
		const { layout, id } = withText("Dag <b>Jan</b> &amp; Els<br>Tot ziens");
		const heading = read(setTextTag(layout, id, "h3"), id);
		expect(heading.kind).toBe("heading");
		expect(heading.kind === "heading" ? heading.tag : null).toBe("h3");
		expect(heading.kind === "heading" ? heading.content : null).toBe("Dag Jan & Els Tot ziens");
		expect(heading.id).toBe(id);

		const retitled = read(setTextTag(setTextTag(layout, id, "h1"), id, "h5"), id);
		expect(retitled.kind === "heading" ? retitled.tag : null).toBe("h5");

		const text = read(setTextTag(updateBlock(setTextTag(layout, id, "h2"), id, { content: "A < B & C" } as Partial<MailBlock>), id, "blockquote"), id);
		expect(text.kind).toBe("text");
		expect(text.kind === "text" ? text.tag : null).toBe("blockquote");
		expect(text.kind === "text" ? text.html : null).toBe("A &lt; B &amp; C");
	});

	it("turns a list into a heading of its items on one line, and a heading into a one item list", () => {
		const { layout, id } = withText("<li>Een</li><li>Twee</li>", "ul");
		const heading = read(setTextTag(layout, id, "h2"), id);
		expect(heading.kind === "heading" ? heading.content : null).toBe("Een Twee");
		const list = read(setTextTag(setTextTag(layout, id, "h2"), id, "ol"), id);
		expect(list.kind === "text" ? list.html : null).toBe("<li>Een Twee</li>");
	});

	it("keeps a block's look, place and id through any change of tag", () => {
		const { layout, id } = withText("Dag");
		const styled = updateBlock(layout, id, { grow: 2, alignSelf: "end", hidden: true } as Partial<MailBlock>);
		const heading = read(setTextTag(styled, id, "h4"), id);
		expect(heading.grow).toBe(2);
		expect(heading.alignSelf).toBe("end");
		expect(heading.hidden).toBe(true);
		expect(heading.id).toBe(id);
	});

	it("ignores an id that is not a text or a container", () => {
		const { layout } = withText("Dag");
		expect(setTextTag(layout, "missing", "h1")).toBe(layout);
		expect(setContainerTag(layout, "missing", "nav")).toBe(layout);
	});
});

describe("columns: rows and cells", () => {
	function table() {
		const layout = emptyLayout();
		const columns = makeColumns(layout);
		return { layout: insertNode(layout, null, columns, null), columns };
	}

	function tableOf(layout: ReturnType<typeof emptyLayout>, id: string): MailColumns {
		return findNode(layout, id) as MailColumns;
	}

	it("adds a row with as many cells as the last one, each holding a text", () => {
		const { layout, columns } = table();
		const next = tableOf(addRow(layout, columns.id), columns.id);
		expect(next.rows).toHaveLength(2);
		expect(next.rows[1]?.cells.map((cell) => cell.width)).toEqual([50, 50]);
		expect(next.rows[1]?.cells.every((cell) => cell.children[0]?.kind === "text")).toBe(true);
		expect(new Set(next.rows.flatMap((row) => [row.id, ...row.cells.map((cell) => cell.id)])).size).toBe(6);
	});

	it("removes a row, and never the last", () => {
		const { layout, columns } = table();
		const two = addRow(layout, columns.id);
		const rows = tableOf(two, columns.id).rows;
		const one = tableOf(removeRow(two, columns.id, rows[0]!.id), columns.id);
		expect(one.rows.map((row) => row.id)).toEqual([rows[1]!.id]);
		const stillOne = removeRow(removeRow(two, columns.id, rows[0]!.id), columns.id, rows[1]!.id);
		expect(tableOf(stillOne, columns.id).rows).toHaveLength(1);
	});

	it("adds a cell and keeps an even row even", () => {
		const { layout, columns } = table();
		const rowId = columns.rows[0]!.id;
		const next = tableOf(addCell(layout, columns.id, rowId), columns.id);
		expect(next.rows[0]?.cells.map((cell) => cell.width)).toEqual([33, 33, 33]);
		expect(next.rows[0]?.cells[2]?.children[0]?.kind).toBe("text");
	});

	it("leaves the widths of an uneven row alone and lets the new cell share what is left", () => {
		const { layout, columns } = table();
		const rowId = columns.rows[0]!.id;
		const firstCell = columns.rows[0]!.cells[0]!;
		const uneven = updateCell(layout, firstCell.id, { width: 30 });
		const next = tableOf(addCell(uneven, columns.id, rowId), columns.id);
		expect(next.rows[0]?.cells.map((cell) => cell.width)).toEqual([30, 50, null]);
	});

	it("removes a cell, with what is in it, and never the last", () => {
		const { layout, columns } = table();
		const rowId = columns.rows[0]!.id;
		const [a, b] = columns.rows[0]!.cells;
		const one = tableOf(removeCell(layout, columns.id, rowId, a!.id), columns.id);
		expect(one.rows[0]?.cells.map((cell) => cell.id)).toEqual([b!.id]);
		expect(one.rows[0]?.cells[0]?.width).toBe(100);
		const still = tableOf(removeCell(removeCell(layout, columns.id, rowId, a!.id), columns.id, rowId, b!.id), columns.id);
		expect(still.rows[0]?.cells).toHaveLength(1);
	});

	it("finds the table and row a cell is in", () => {
		const { layout, columns } = table();
		const cell = columns.rows[0]!.cells[1]!;
		const at = locateCell(layout, cell.id);
		expect(at?.columns.id).toBe(columns.id);
		expect(at?.row.id).toBe(columns.rows[0]!.id);
		expect(at?.index).toBe(1);
		expect(locateCell(layout, "nope")).toBeNull();
	});
});

describe("a link on a picture", () => {
	it("keeps https and mailto and placeholders, and refuses anything else", () => {
		expect(safeLink("https://example.be")).toBe(true);
		expect(safeLink("mailto:jan@example.be")).toBe(true);
		expect(safeLink("{{document.link}}")).toBe(true);
		expect(safeLink("http://example.be")).toBe(false);
		expect(safeLink("javascript:alert(1)")).toBe(false);
		expect(safeLink("data:text/html,x")).toBe(false);
		expect(safeLink("")).toBe(false);
	});
});

describe("a list after it was typed in", () => {
	it("keeps its items, and puts bare words back into one", () => {
		expect(asListItems("<li>Een</li><li>Twee</li>")).toBe("<li>Een</li><li>Twee</li>");
		expect(asListItems("Een<br>Twee")).toBe("<li>Een</li><li>Twee</li>");
		expect(asListItems("")).toBe("<li></li>");
	});
});
