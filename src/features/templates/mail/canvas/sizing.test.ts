import { describe, expect, it } from "vitest";
import type { MailBlock, MailSection } from "@shared/types";
import { emptySection, newBlock, updateBlock } from "./canvas-actions";
import {
	acrossOf,
	alignAcross,
	heightModes,
	heightSizing,
	setWidth,
	sizeHeight,
	sizeWidth,
	widthModes,
	widthSizing,
} from "./sizing";

function column(): MailSection {
	return emptySection("Body");
}

function row(): MailSection {
	const section = emptySection("Row");
	return { ...section, layout: { kind: "flex", direction: "row", justify: "start", align: "stretch", gap: 8, wrap: false } };
}

function grid(): MailSection {
	return { ...emptySection("Grid"), layout: { kind: "grid", columns: 2, gap: 8, align: "stretch" } };
}

/** Applies a patch the way the editor does, through updateBlock. */
function apply(block: MailBlock, section: MailSection, patch: Partial<MailBlock>): MailBlock {
	const layout = { version: 1 as const, width: 600, minHeight: 0, fill: null, fonts: [], customCss: null, sections: [{ ...section, blocks: [block] }] };
	return updateBlock(layout, section.id, block.id, patch).sections[0]!.blocks[0]!;
}

describe("resizing in a section that runs down", () => {
	it("reads a stretched text block as filling the width and hugging the height", () => {
		const text = newBlock("text");
		expect(widthSizing(text, column())).toBe("fill");
		expect(heightSizing(text, column())).toBe("hug");
	});

	it("hugs a width by letting go of the stretch, not by dropping a number", () => {
		const section = column();
		const text = newBlock("text");
		const hugged = apply(text, section, sizeWidth(text, section, "hug", 600));
		expect(hugged.alignSelf).toBe("start");
		expect(widthSizing(hugged, section)).toBe("hug");
	});

	it("fixes a width at the size it is drawn, and fills again without a number", () => {
		const section = column();
		const text = newBlock("text");
		const fixed = apply(text, section, sizeWidth(text, section, "fixed", 312.4));
		expect(fixed.kind === "text" ? fixed.box.width : null).toBe(312);
		expect(widthSizing(fixed, section)).toBe("fixed");
		const filled = apply(fixed, section, sizeWidth(fixed, section, "fill", 312));
		expect(filled.kind === "text" ? filled.box.width : 0).toBeNull();
		expect(widthSizing(filled, section)).toBe("fill");
	});

	it("fills the height with a share of the room, which is the direction the section runs", () => {
		const section = column();
		const text = newBlock("text");
		const filled = apply(text, section, sizeHeight(text, section, "fill", null));
		expect(filled.grow).toBe(1);
		expect(heightSizing(filled, section)).toBe("fill");
		const hugged = apply(filled, section, sizeHeight(filled, section, "hug", null));
		expect(hugged.grow).toBe(0);
	});

	it("reads a typed width as fixed", () => {
		const section = column();
		const text = newBlock("text");
		const typed = apply(text, section, setWidth(text, section, 100));
		expect(typed.kind === "text" ? typed.box.width : null).toBe(100);
		expect(widthSizing(typed, section)).toBe("fixed");
	});
});

describe("resizing in a section that runs across", () => {
	it("fills the width with a share of the room and the height by stretching", () => {
		const section = row();
		const text = newBlock("text");
		expect(widthSizing(text, section)).toBe("hug");
		const wide = apply(text, section, sizeWidth(text, section, "fill", null));
		expect(wide.grow).toBe(1);
		expect(widthSizing(wide, section)).toBe("fill");
		expect(heightSizing(wide, section)).toBe("fill");
		const short = apply(wide, section, sizeHeight(wide, section, "hug", null));
		expect(short.alignSelf).toBe("start");
		expect(heightSizing(short, section)).toBe("hug");
	});

	it("gives a spacer a width only here, where filling pushes its neighbours apart", () => {
		expect(widthModes(newBlock("spacer"), column())).toEqual([]);
		expect(widthModes(newBlock("spacer"), row())).toEqual(["hug", "fill"]);
	});
});

describe("what each block can be given", () => {
	it("never lets a rule hug, and gives it no height", () => {
		const divider = newBlock("divider");
		expect(widthModes(divider, column())).toEqual(["fixed", "fill"]);
		expect(heightModes(divider)).toEqual([]);
	});

	it("offers no hug in a grid cell", () => {
		expect(widthModes(newBlock("text"), grid())).toEqual(["fixed", "fill"]);
	});

	it("offers code nothing, because its size is in its code", () => {
		expect(widthModes(newBlock("html"), column())).toEqual([]);
		expect(heightModes(newBlock("html"))).toEqual([]);
	});
});

describe("placing a block across its section", () => {
	it("shows nothing pressed while a block is stretched", () => {
		expect(acrossOf(newBlock("text"), column())).toBeNull();
	});

	it("moves a picture by its margins as well, for clients without flexbox", () => {
		const section = column();
		const image = newBlock("image");
		const centred = apply(image, section, alignAcross(image, section, "center"));
		expect(centred.alignSelf).toBe("center");
		expect(centred.kind === "image" ? centred.align : null).toBe("center");
		expect(acrossOf(centred, section)).toBe("center");
		expect(widthSizing(centred, section)).toBe("hug");
	});

	it("takes a picture's margins away when it is stretched, or they would hold it", () => {
		const section = column();
		const image = apply(newBlock("image"), section, { align: "center" } as Partial<MailBlock>);
		const filled = apply(image, section, sizeWidth(image, section, "fill", null));
		expect(filled.kind === "image" ? filled.align : null).toBe("left");
		expect(widthSizing(filled, section)).toBe("fill");
	});
});
