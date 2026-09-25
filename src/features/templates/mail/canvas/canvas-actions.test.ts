import { describe, expect, it } from "vitest";
import {
	addBlock,
	addSection,
	cloneBlock,
	cloneSection,
	colorsIn,
	dropBlock,
	emptyLayout,
	emptySection,
	insertBlockAfter,
	insertSectionAfter,
	moveBlock,
	moveSection,
	moveSectionTo,
	newBlock,
	removeBlock,
	removeSection,
	reparentBlock,
	replaceColor,
	selectionIn,
	siblingOf,
	updateBlock,
	updateSection,
} from "./canvas-actions";

function withTwoBlocks() {
	const layout = emptyLayout();
	const section = layout.sections[0]!;
	const first = newBlock("text");
	const second = newBlock("heading");
	return {
		layout: addBlock(addBlock(layout, section.id, first), section.id, second),
		sectionId: section.id,
		firstId: first.id,
		secondId: second.id,
	};
}

describe("editing a canvas", () => {
	it("never mutates the layout it was given", () => {
		const layout = emptyLayout();
		const before = JSON.stringify(layout);
		addBlock(layout, layout.sections[0]!.id, newBlock("text"));
		addSection(layout);
		expect(JSON.stringify(layout)).toBe(before);
	});

	it("adds a section after the one given rather than at the end", () => {
		const layout = addSection(addSection(emptyLayout()));
		const middle = layout.sections[0]!.id;
		const next = addSection(layout, middle);
		expect(next.sections).toHaveLength(4);
		expect(next.sections[0]?.id).toBe(middle);
		expect(next.sections[1]?.id).not.toBe(layout.sections[1]?.id);
	});

	it("keeps one section when the last one is removed", () => {
		// Removing it outright would leave nowhere to put a block and no control
		// to put a section back, which reads as a broken editor.
		const layout = emptyLayout();
		const emptied = removeSection(layout, layout.sections[0]!.id);
		expect(emptied.sections).toHaveLength(1);
		expect(emptied.sections[0]?.blocks).toEqual([]);
	});

	it("moves a block within its section and refuses to move it off either end", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		const moved = moveBlock(layout, sectionId, firstId, 1);
		expect(moved.sections[0]?.blocks.map((block) => block.id)).toEqual([secondId, firstId]);
		expect(moveBlock(layout, sectionId, firstId, -1)).toEqual(layout);
	});

	it("moves a block into another section", () => {
		const { layout, sectionId, firstId } = withTwoBlocks();
		const twoSections = addSection(layout);
		const other = twoSections.sections[1]!.id;
		const moved = reparentBlock(twoSections, sectionId, other, firstId);
		expect(moved.sections[0]?.blocks.map((block) => block.id)).not.toContain(firstId);
		expect(moved.sections[1]?.blocks.map((block) => block.id)).toEqual([firstId]);
	});

	it("leaves a reparent into the same section alone", () => {
		const { layout, sectionId, firstId } = withTwoBlocks();
		expect(reparentBlock(layout, sectionId, sectionId, firstId)).toEqual(layout);
	});

	it("drops a block in front of the one it was let go on", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		const dropped = dropBlock(layout, sectionId, sectionId, secondId, firstId);
		expect(dropped.sections[0]?.blocks.map((block) => block.id)).toEqual([secondId, firstId]);
	});

	it("drops a block at the end of the section it was let go on", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		const twoSections = addSection(layout);
		const other = twoSections.sections[1]!.id;
		const dropped = dropBlock(twoSections, sectionId, other, firstId, null);
		expect(dropped.sections[0]?.blocks.map((block) => block.id)).toEqual([secondId]);
		expect(dropped.sections[1]?.blocks.map((block) => block.id)).toEqual([firstId]);
	});

	it("patches one block and leaves its neighbour untouched", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		const next = updateBlock(layout, sectionId, firstId, { grow: 3 });
		expect(next.sections[0]?.blocks.find((block) => block.id === firstId)?.grow).toBe(3);
		expect(next.sections[0]?.blocks.find((block) => block.id === secondId)?.grow).toBe(0);
	});

	it("removes one block without touching the rest", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		const next = removeBlock(layout, sectionId, firstId);
		expect(next.sections[0]?.blocks.map((block) => block.id)).toEqual([secondId]);
	});

	it("switches a section from flex to grid", () => {
		const layout = emptyLayout();
		const sectionId = layout.sections[0]!.id;
		const next = updateSection(layout, sectionId, {
			layout: { kind: "grid", columns: 3, gap: 8, align: "start" },
		});
		expect(next.sections[0]?.layout).toEqual({ kind: "grid", columns: 3, gap: 8, align: "start" });
	});

	it("refuses to move a section past either end", () => {
		const layout = addSection(emptyLayout());
		expect(moveSection(layout, layout.sections[0]!.id, -1)).toEqual(layout);
		expect(moveSection(layout, layout.sections[1]!.id, 1)).toEqual(layout);
		expect(moveSection(layout, layout.sections[0]!.id, 1).sections[0]?.id).toBe(layout.sections[1]?.id);
	});
});

describe("selection colours", () => {
	function coloured() {
		const layout = emptyLayout();
		const sectionId = layout.sections[0]!.id;
		const button = newBlock("button");
		const text = newBlock("text");
		const styled =
			text.kind === "text" ? { ...text, text: { ...text.text, color: "#4A3FA0" } } : text;
		return {
			layout: addBlock(addBlock({ ...layout, fill: { kind: "solid" as const, color: "#f6f6fa", hidden: false } }, sectionId, button), sectionId, styled),
			sectionId,
			buttonId: button.id,
			textId: text.id,
		};
	}

	it("lists each colour once, whatever case it was typed in", () => {
		const { layout } = coloured();
		expect(colorsIn(layout, null)).toEqual(["#f6f6fa", "#4a3fa0", "#ffffff"]);
	});

	it("only lists what is in the selection", () => {
		const { layout, sectionId, textId } = coloured();
		expect(colorsIn(layout, { sectionId, blockId: textId })).toEqual(["#4a3fa0"]);
	});

	it("changes a colour inside the selection and leaves the rest alone", () => {
		const { layout, sectionId, textId, buttonId } = coloured();
		const next = replaceColor(layout, { sectionId, blockId: textId }, "#4a3fa0", "#1f6a4d");
		const blocks = next.sections[0]!.blocks;
		const text = blocks.find((block) => block.id === textId);
		const button = blocks.find((block) => block.id === buttonId);
		expect(text?.kind === "text" ? text.text.color : null).toBe("#1f6a4d");
		// The button uses the same purple and was not selected.
		expect(button?.kind === "button" ? button.background : null).toBe("#4a3fa0");
	});
});

describe("dragging sections", () => {
	it("drops a section in front of another, and at the end when there is none", () => {
		const layout = addSection(addSection(emptyLayout()));
		const [first, second, third] = layout.sections.map((section) => section.id);
		expect(moveSectionTo(layout, third!, first!).sections.map((section) => section.id)).toEqual([third, first, second]);
		expect(moveSectionTo(layout, first!, null).sections.map((section) => section.id)).toEqual([second, third, first]);
		expect(moveSectionTo(layout, second!, second!)).toEqual(layout);
	});
});

describe("copying and pasting", () => {
	it("gives a copy new ids all the way down", () => {
		const { layout, sectionId } = withTwoBlocks();
		const section = layout.sections.find((entry) => entry.id === sectionId)!;
		const copy = cloneSection(section);
		expect(copy.id).not.toBe(section.id);
		expect(copy.blocks.map((block) => block.id)).not.toContain(section.blocks[0]!.id);
		expect(copy.blocks.map((block) => block.kind)).toEqual(["text", "heading"]);
		// A deep copy: changing the copy leaves the original as it was.
		const block = copy.blocks[0]!;
		if (block.kind === "text") block.text.italic = true;
		const original = section.blocks[0]!;
		expect(original.kind === "text" ? original.text.italic : null).toBe(false);
	});

	it("puts a pasted block straight after the one selected, or at the end", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		const copy = cloneBlock(newBlock("button"));
		const after = insertBlockAfter(layout, sectionId, firstId, copy);
		expect(after.sections[0]!.blocks.map((block) => block.id)).toEqual([firstId, copy.id, secondId]);
		const atEnd = insertBlockAfter(layout, sectionId, null, copy);
		expect(atEnd.sections[0]!.blocks.map((block) => block.id)).toEqual([firstId, secondId, copy.id]);
	});

	it("puts a pasted section straight after the one selected", () => {
		const layout = addSection(emptyLayout());
		const [first, second] = layout.sections.map((section) => section.id);
		const copy = emptySection("Copy");
		expect(insertSectionAfter(layout, first!, copy).sections.map((section) => section.id)).toEqual([first, copy.id, second]);
		expect(insertSectionAfter(layout, null, copy).sections.map((section) => section.id)).toEqual([first, second, copy.id]);
	});
});

describe("stepping through the layers", () => {
	it("goes round among the blocks of one section", () => {
		const { layout, sectionId, firstId, secondId } = withTwoBlocks();
		expect(siblingOf(layout, { sectionId, blockId: firstId }, 1)).toEqual({ sectionId, blockId: secondId });
		expect(siblingOf(layout, { sectionId, blockId: secondId }, 1)).toEqual({ sectionId, blockId: firstId });
		expect(siblingOf(layout, { sectionId, blockId: firstId }, -1)).toEqual({ sectionId, blockId: secondId });
	});

	it("knows when an undo took the selection away", () => {
		const { layout, sectionId, firstId } = withTwoBlocks();
		expect(selectionIn(layout, { sectionId, blockId: firstId })).toBe(true);
		expect(selectionIn(removeBlock(layout, sectionId, firstId), { sectionId, blockId: firstId })).toBe(false);
		expect(selectionIn(layout, null)).toBe(true);
	});
});

describe("what is added", () => {
	it("gives a section an author adds room around what goes in it", () => {
		const added = addSection(emptyLayout());
		expect(added.sections[1]!.box.padding).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
		// The bare one holds a hand-written body, which padding would change.
		expect(emptySection().box.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
	});

	it("makes a button and a picture hug their content", () => {
		expect(newBlock("button").alignSelf).toBe("start");
		expect(newBlock("image").alignSelf).toBe("start");
		expect(newBlock("text").alignSelf).toBe("auto");
	});
});
