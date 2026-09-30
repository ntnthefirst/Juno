import { describe, expect, it } from "vitest";
import type { MailBlock, MailContainer, MailLayout } from "@shared/types";
import { addBreakpoint, absorb, copyOverrides, layoutAt, removeBreakpoint, renameBreakpoint, resizeBreakpoint } from "./breakpoints";
import {
	emptyLayout,
	findCell,
	insertNode,
	newBlock,
	newColumns,
	updateBlock,
	updateCell,
	updateColumns,
	updateSection,
} from "./canvas-actions";

/** Every top-level child in these tests is a section, which is how a new canvas starts. */
function asSection(node: { id: string }): MailContainer {
	return node as MailContainer;
}

function withText(): { layout: MailLayout; sectionId: string; blockId: string } {
	const layout = emptyLayout();
	const sectionId = layout.children[0]!.id;
	const block = newBlock("text");
	return { layout: insertNode(layout, sectionId, block, null), sectionId, blockId: block.id };
}

function fontSize(layout: MailLayout, blockId: string): number | null {
	const block = layout.children.flatMap((node) => asSection(node).children).find((entry) => entry.id === blockId);
	return block?.kind === "text" ? block.text.fontSize : null;
}

describe("breakpoints on the canvas", () => {
	it("adds a breakpoint narrower than what is there, as a copy that changes nothing", () => {
		const { layout, blockId } = withText();
		const added = addBreakpoint(layout);
		if (!added) throw new Error("no breakpoint");
		expect(added.layout.breakpoints).toEqual([{ id: added.id, name: "Phone", maxWidth: 480, sections: {}, blocks: {} }]);
		const phone = layoutAt(added.layout, added.id);
		expect(phone.width).toBe(480);
		expect(phone.children).toEqual(layout.children);
		expect(fontSize(phone, blockId)).toBeNull();
		const second = addBreakpoint(added.layout);
		expect(second?.layout.breakpoints[1]?.maxWidth).toBe(360);
	});

	it("keeps a change made at a breakpoint to that breakpoint", () => {
		const { layout, blockId } = withText();
		const added = addBreakpoint(layout)!;
		const drawn = layoutAt(added.layout, added.id);
		const firstBlock = asSection(drawn.children[0]!).children[0];
		if (firstBlock?.kind !== "text") throw new Error("not text");
		const edited = updateBlock(drawn, blockId, {
			text: { ...firstBlock.text, fontSize: 13 },
		});
		const next = absorb(added.layout, added.id, edited);
		expect(next.breakpoints[0]?.blocks[blockId]).toEqual({ text: { fontSize: 13 } });
		expect(fontSize(next, blockId)).toBeNull();
		expect(fontSize(layoutAt(next, added.id), blockId)).toBe(13);
	});

	it("keeps a margin and a padding set at a breakpoint to that breakpoint", () => {
		const { layout, sectionId, blockId } = withText();
		const added = addBreakpoint(layout)!;
		const drawn = layoutAt(added.layout, added.id);
		const block = asSection(drawn.children[0]!).children[0];
		if (block?.kind !== "text") throw new Error("not text");
		let edited = updateBlock(drawn, blockId, { box: { ...block.box, margin: { top: 12, right: 0, bottom: 0, left: 0 } } });
		const section = asSection(edited.children[0]!);
		edited = updateSection(edited, sectionId, { box: { ...section.box, padding: { top: 4, right: 4, bottom: 4, left: 4 } } });
		const next = absorb(added.layout, added.id, edited);
		expect(next.breakpoints[0]?.blocks[blockId]).toEqual({ box: { margin: { top: 12, right: 0, bottom: 0, left: 0 } } });
		expect(next.breakpoints[0]?.sections[sectionId]).toEqual({ box: { padding: { top: 4, right: 4, bottom: 4, left: 4 } } });
		const stored = asSection(next.children[0]!).children[0];
		expect(stored?.kind === "text" ? stored.box.margin.top : null).toBe(0);
		const phone = asSection(layoutAt(next, added.id).children[0]!).children[0];
		expect(phone?.kind === "text" ? phone.box.margin.top : null).toBe(12);
	});

	it("sends what a block says to the default, because the words are the same at every width", () => {
		const { layout, blockId } = withText();
		const added = addBreakpoint(layout)!;
		const edited = updateBlock(layoutAt(added.layout, added.id), blockId, { html: "Hallo" } as never);
		const next = absorb(added.layout, added.id, edited);
		const block = asSection(next.children[0]!).children[0]!;
		expect(block.kind === "text" ? block.html : null).toBe("Hallo");
		expect(next.breakpoints[0]?.blocks[blockId]).toBeUndefined();
	});

	it("lets a narrower breakpoint put back what a wider one changed", () => {
		const { layout, blockId } = withText();
		const phone = addBreakpoint(layout)!;
		const small = addBreakpoint(phone.layout)!;
		const at = (current: MailLayout, id: string, size: number | null) => {
			const drawn = layoutAt(current, id);
			const block = asSection(drawn.children[0]!).children[0]!;
			if (block.kind !== "text") throw new Error("not text");
			return absorb(current, id, updateBlock(drawn, blockId, { text: { ...block.text, fontSize: size } }));
		};
		const narrowed = at(small.layout, phone.id, 13);
		expect(fontSize(layoutAt(narrowed, small.id), blockId)).toBe(13);
		const restored = at(narrowed, small.id, null);
		expect(restored.breakpoints[1]?.blocks[blockId]).toEqual({ text: { fontSize: null } });
		expect(fontSize(layoutAt(restored, small.id), blockId)).toBeNull();
		expect(fontSize(layoutAt(restored, phone.id), blockId)).toBe(13);
	});

	it("keeps the frame's width for the default and gives a breakpoint its own", () => {
		const { layout } = withText();
		const added = addBreakpoint(layout)!;
		const drawn = layoutAt(added.layout, added.id);
		const next = absorb(added.layout, added.id, { ...drawn, width: 420, fill: { kind: "solid", color: "#f6f6fa", hidden: false } });
		expect(next.width).toBe(600);
		expect(next.breakpoints[0]?.maxWidth).toBe(420);
		expect(next.fill).toEqual({ kind: "solid", color: "#f6f6fa", hidden: false });
	});

	it("hides a section at one breakpoint only", () => {
		const { layout, sectionId } = withText();
		const added = addBreakpoint(layout)!;
		const next = absorb(added.layout, added.id, updateSection(layoutAt(added.layout, added.id), sectionId, { hidden: true }));
		expect(next.children[0]?.hidden).toBe(false);
		expect(next.breakpoints[0]?.sections[sectionId]).toEqual({ hidden: true });
	});

	it("hides a columns table and styles one of its cells at one breakpoint only", () => {
		const base = emptyLayout();
		const columns = newColumns(base);
		const layout = insertNode(base, null, columns, null);
		const cell = columns.rows[0]!.cells[0]!;
		const added = addBreakpoint(layout)!;
		const drawn = layoutAt(added.layout, added.id);
		const hiddenTable = absorb(added.layout, added.id, updateColumns(drawn, columns.id, { hidden: true }));
		expect(hiddenTable.children[1]?.hidden).toBe(false);
		expect(hiddenTable.breakpoints[0]?.sections[columns.id]).toEqual({ hidden: true });

		const padded = absorb(
			added.layout,
			added.id,
			updateCell(drawn, cell.id, { box: { ...findCell(drawn, cell.id)!.box, padding: { top: 4, right: 4, bottom: 4, left: 4 } } }),
		);
		expect(padded.breakpoints[0]?.sections[cell.id]).toEqual({ box: { padding: { top: 4, right: 4, bottom: 4, left: 4 } } });
		expect(findCell(padded, cell.id)?.box.padding.top).toBe(0);
		expect(findCell(layoutAt(padded, added.id), cell.id)?.box.padding.top).toBe(4);
	});

	it("hides a block inside a cell at one breakpoint only", () => {
		const base = emptyLayout();
		const columns = newColumns(base);
		const layout = insertNode(base, null, columns, null);
		const inner = columns.rows[0]!.cells[1]!.children[0]!;
		const added = addBreakpoint(layout)!;
		const drawn = layoutAt(added.layout, added.id);
		const next = absorb(added.layout, added.id, updateBlock(drawn, inner.id, { hidden: true } as Partial<MailBlock>));
		expect(next.breakpoints[0]?.blocks[inner.id]).toEqual({ hidden: true });
		const table = next.children[1];
		expect(table?.kind === "columns" ? table.rows[0]?.cells[1]?.children[0]?.hidden : null).toBe(false);
	});

	it("renames, resizes and removes a breakpoint", () => {
		const { layout } = withText();
		const added = addBreakpoint(layout)!;
		expect(renameBreakpoint(added.layout, added.id, "  Gsm ").breakpoints[0]?.name).toBe("Gsm");
		expect(renameBreakpoint(added.layout, added.id, " ").breakpoints[0]?.name).toBe("Phone");
		expect(resizeBreakpoint(added.layout, added.id, 50).breakpoints[0]?.maxWidth).toBe(200);
		expect(removeBreakpoint(added.layout, added.id).breakpoints).toEqual([]);
	});

	it("gives a copy what its original changes at each breakpoint", () => {
		const { layout, blockId } = withText();
		const added = addBreakpoint(layout)!;
		const changed: MailLayout = {
			...added.layout,
			breakpoints: [{ ...added.layout.breakpoints[0]!, blocks: { [blockId]: { hidden: true } } }],
		};
		expect(copyOverrides(changed, [[blockId, "copy"]]).breakpoints[0]?.blocks.copy).toEqual({ hidden: true });
	});
});
