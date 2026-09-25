import { describe, expect, it } from "vitest";
import {
	addBlock,
	addSection,
	emptyLayout,
	moveBlock,
	moveSection,
	newBlock,
	removeBlock,
	removeSection,
	reparentBlock,
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
