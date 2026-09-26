import { describe, expect, it } from "vitest";
import type { MailLayout } from "@shared/types";
import { addBreakpoint, absorb, copyOverrides, layoutAt, removeBreakpoint, renameBreakpoint, resizeBreakpoint } from "./breakpoints";
import { addBlock, emptyLayout, newBlock, updateBlock, updateSection } from "./canvas-actions";

function withText(): { layout: MailLayout; sectionId: string; blockId: string } {
	const layout = emptyLayout();
	const sectionId = layout.sections[0]!.id;
	const block = newBlock("text");
	return { layout: addBlock(layout, sectionId, block), sectionId, blockId: block.id };
}

function fontSize(layout: MailLayout, blockId: string): number | null {
	const block = layout.sections.flatMap((section) => section.blocks).find((entry) => entry.id === blockId);
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
		expect(phone.sections).toEqual(layout.sections);
		expect(fontSize(phone, blockId)).toBeNull();
		const second = addBreakpoint(added.layout);
		expect(second?.layout.breakpoints[1]?.maxWidth).toBe(360);
	});

	it("keeps a change made at a breakpoint to that breakpoint", () => {
		const { layout, sectionId, blockId } = withText();
		const added = addBreakpoint(layout)!;
		const drawn = layoutAt(added.layout, added.id);
		const edited = updateBlock(drawn, sectionId, blockId, {
			text: { ...(drawn.sections[0]!.blocks[0] as Extract<MailLayout["sections"][0]["blocks"][0], { kind: "text" }>).text, fontSize: 13 },
		});
		const next = absorb(added.layout, added.id, edited);
		expect(next.breakpoints[0]?.blocks[blockId]).toEqual({ text: { fontSize: 13 } });
		expect(fontSize(next, blockId)).toBeNull();
		expect(fontSize(layoutAt(next, added.id), blockId)).toBe(13);
	});

	it("sends what a block says to the default, because the words are the same at every width", () => {
		const { layout, sectionId, blockId } = withText();
		const added = addBreakpoint(layout)!;
		const edited = updateBlock(layoutAt(added.layout, added.id), sectionId, blockId, { html: "Hallo" } as never);
		const next = absorb(added.layout, added.id, edited);
		const block = next.sections[0]!.blocks[0]!;
		expect(block.kind === "text" ? block.html : null).toBe("Hallo");
		expect(next.breakpoints[0]?.blocks[blockId]).toBeUndefined();
	});

	it("lets a narrower breakpoint put back what a wider one changed", () => {
		const { layout, sectionId, blockId } = withText();
		const phone = addBreakpoint(layout)!;
		const small = addBreakpoint(phone.layout)!;
		const at = (current: MailLayout, id: string, size: number | null) => {
			const drawn = layoutAt(current, id);
			const block = drawn.sections[0]!.blocks[0]!;
			if (block.kind !== "text") throw new Error("not text");
			return absorb(current, id, updateBlock(drawn, sectionId, blockId, { text: { ...block.text, fontSize: size } }));
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
		expect(next.sections[0]?.hidden).toBe(false);
		expect(next.breakpoints[0]?.sections[sectionId]).toEqual({ hidden: true });
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
