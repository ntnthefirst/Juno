/**
 * Figma's resizing, read from and written to the model a message can carry.
 *
 * Figma gives every layer in an auto layout a width and a height that are each
 * fixed, hug or fill. The model has no such field: it has what the CSS has, a
 * block's own width and least height, its share of the room along its parent
 * (`grow`), and where it sits across it (`alignSelf`). "Section" below names
 * whatever container a block sits directly in: the model is a tree now
 * (docs/editors.md section 2), so a block's parent can be nested as deeply as
 * the frame allows, and every function here works the same regardless, since
 * they only ever look at the one container a block is actually in and never at
 * where that container itself sits. Which of those a mode means depends on
 * which way the parent runs, so it is worked out here, once, and the panel and
 * the shortcuts both ask:
 *
 * | Section runs | Width fill | Width hug | Height fill | Height hug |
 * | --- | --- | --- | --- | --- |
 * | Down (column) | stretched across | not stretched | a share of the room | no share |
 * | Across (row) | a share of the room | no share | stretched down | not stretched |
 * | Grid | the cell's width | not offered | stretched down | not stretched |
 *
 * Fixed is always the block's own number, a width that still gives way on a
 * narrow screen and a height the content can grow past.
 *
 * The frame and a table cell are not flex or grid boxes: they lay what is in
 * them out in plain flow, one under the next. That is a `null` parent below
 * (a `Placer`). Nothing there has a share of the room or an alignment of its
 * own, so a width is fixed or fills (the way a block level element does by
 * default), a height is a least height, and a picture or a button, which do
 * not stretch, hug instead of filling.
 */
import type { MailAlign, MailBlock, MailContainer } from "@shared/types";

export type Sizing = "fixed" | "hug" | "fill";

export type Flow = "column" | "row" | "grid";

/** Where a block can be put across its section. Stretching is not one of them: it is a fill. */
export type Across = "start" | "center" | "end";

type Patch = Partial<MailBlock>;

/** What lays a node out: a container's flex or grid, or null for plain flow (the frame, a table cell). */
export type Placer = MailContainer | null;

export function flowOf(section: MailContainer): Flow {
	if (section.layout.kind === "grid") return "grid";
	return section.layout.direction === "row" ? "row" : "column";
}

/** Where a block sits across its section, with "auto" read as what the section says. */
export function alignOf(block: MailBlock, section: MailContainer): MailAlign {
	return block.alignSelf === "auto" ? section.layout.align : block.alignSelf;
}

/** The block's own width in pixels, when it has one. */
export function fixedWidth(block: MailBlock): number | null {
	if (block.kind === "image") return block.width;
	if (block.kind === "spacer" || block.kind === "html") return null;
	return block.box.width;
}

/** The block's own height in pixels, when it has one: a spacer's, or a least height. */
export function fixedHeight(block: MailBlock): number | null {
	if (block.kind === "spacer") return block.height;
	if (block.kind === "html" || block.kind === "image" || block.kind === "divider") return null;
	return block.box.minHeight;
}

/**
 * The width modes a block can be given where it is. A divider is a rule that
 * spans what it is given, so it cannot hug; a spacer only has a width in a row,
 * where filling is what pushes its neighbours apart; code is sized by its code.
 */
export function widthModes(block: MailBlock, section: Placer): Sizing[] {
	if (!section) {
		switch (block.kind) {
			case "html":
			case "spacer":
				return [];
			case "image":
			case "button":
				return ["fixed", "hug"];
			default:
				return ["fixed", "fill"];
		}
	}
	const flow = flowOf(section);
	switch (block.kind) {
		case "html":
			return [];
		case "spacer":
			return flow === "row" ? ["hug", "fill"] : [];
		case "divider":
			return ["fixed", "fill"];
		default:
			return flow === "grid" ? ["fixed", "fill"] : ["fixed", "hug", "fill"];
	}
}

/** The height modes. A picture keeps its proportions and a rule is its thickness. */
export function heightModes(block: MailBlock, section?: Placer): Sizing[] {
	switch (block.kind) {
		case "html":
		case "image":
		case "divider":
			return [];
		case "spacer":
			return ["fixed"];
		default:
			// In plain flow there is no room to take a share of.
			return section === null ? ["fixed", "hug"] : ["fixed", "hug", "fill"];
	}
}

export function widthSizing(block: MailBlock, section: Placer): Sizing {
	if (fixedWidth(block) !== null) return "fixed";
	if (!section) return block.kind === "image" || block.kind === "button" ? "hug" : "fill";
	const flow = flowOf(section);
	// A rule with no width of its own is written at 100%.
	if (block.kind === "divider") return "fill";
	if (flow === "row") return block.grow > 0 ? "fill" : "hug";
	if (flow === "grid") return "fill";
	// A picture pushed to the middle or the side by its margins cannot be
	// stretched, whatever the section says, and neither can anything that is
	// not set to stretch.
	if (block.kind === "image" && block.align !== "left" && block.align !== "justify") return "hug";
	return alignOf(block, section) === "stretch" ? "fill" : "hug";
}

export function heightSizing(block: MailBlock, section: Placer): Sizing {
	if (fixedHeight(block) !== null) return "fixed";
	if (!section) return "hug";
	if (flowOf(section) === "column") return block.grow > 0 ? "fill" : "hug";
	return alignOf(block, section) === "stretch" ? "fill" : "hug";
}

function withWidth(block: MailBlock, width: number | null): Patch {
	if (block.kind === "image") return { width } as Patch;
	if (block.kind === "spacer" || block.kind === "html") return {};
	return { box: { ...block.box, width } } as Patch;
}

function withHeight(block: MailBlock, height: number | null): Patch {
	if (block.kind === "spacer") return height === null ? {} : ({ height } as Patch);
	if (block.kind === "html" || block.kind === "image" || block.kind === "divider") return {};
	return { box: { ...block.box, minHeight: height } } as Patch;
}

/** Lets go of a stretch, so the block sits at the start rather than being pulled across. */
function unstretched(block: MailBlock, section: MailContainer): Patch {
	return alignOf(block, section) === "stretch" ? ({ alignSelf: "start" } as Patch) : {};
}

/** Stretches across, writing nothing when the section already stretches everything. */
function stretched(section: MailContainer): Patch {
	return { alignSelf: section.layout.align === "stretch" ? "auto" : "stretch" } as Patch;
}

/**
 * The change that gives a block a width mode. `measured` is how wide it is
 * drawn right now, which is what fixed starts from, the way Figma keeps a
 * layer the size it was when it is switched to fixed.
 */
export function sizeWidth(block: MailBlock, section: Placer, mode: Sizing, measured: number | null): Patch {
	const px = Math.max(1, Math.round(measured ?? (block.kind === "image" ? 300 : 240)));
	// Plain flow: the width is the block's own or nothing, and nothing is how
	// it fills, so there is no share and no alignment to give up or take.
	if (!section) return withWidth(block, mode === "fixed" ? px : null);
	const flow = flowOf(section);
	if (mode === "fixed") {
		return {
			...withWidth(block, px),
			...(flow === "row" ? { grow: 0 } : {}),
			...(flow === "column" ? unstretched(block, section) : {}),
		} as Patch;
	}
	if (mode === "hug") {
		return {
			...withWidth(block, null),
			...(flow === "row" ? { grow: 0 } : {}),
			...(flow === "column" ? unstretched(block, section) : {}),
		} as Patch;
	}
	// Fill.
	if (flow === "row") return { ...withWidth(block, null), grow: Math.max(block.grow, 1) } as Patch;
	if (flow === "grid" || block.kind === "divider") return withWidth(block, null);
	return {
		...withWidth(block, null),
		...stretched(section),
		// A picture's margins would hold it in place against the stretch.
		...(block.kind === "image" ? { align: "left" } : {}),
	} as Patch;
}

export function sizeHeight(block: MailBlock, section: Placer, mode: Sizing, measured: number | null): Patch {
	const px = Math.max(1, Math.round(measured ?? 80));
	if (!section) return withHeight(block, mode === "fixed" ? px : null);
	const flow = flowOf(section);
	if (mode === "fixed") {
		return {
			...withHeight(block, px),
			...(flow === "column" ? { grow: 0 } : unstretched(block, section)),
		} as Patch;
	}
	if (mode === "hug") {
		return {
			...withHeight(block, null),
			...(flow === "column" ? { grow: 0 } : unstretched(block, section)),
		} as Patch;
	}
	if (flow === "column") return { ...withHeight(block, null), grow: Math.max(block.grow, 1) } as Patch;
	return { ...withHeight(block, null), ...stretched(section) } as Patch;
}

/** A width typed into the W field: the block becomes fixed at it. */
export function setWidth(block: MailBlock, section: Placer, px: number): Patch {
	return sizeWidth(block, section, "fixed", px);
}

/** A height typed into the H field. */
export function setHeight(block: MailBlock, section: Placer, px: number): Patch {
	return sizeHeight(block, section, "fixed", px);
}

const PICTURE_ALIGN = { start: "left", center: "center", end: "right" } as const;

/**
 * Puts a block at the start, the middle or the end across its section, or back
 * to what the section says with null.
 *
 * A picture in a column is also moved by its margins, because those are what
 * a client without flexbox reads: Outlook centres a picture on `margin:0 auto`
 * and ignores `align-self` entirely.
 */
export function alignAcross(block: MailBlock, section: Placer, across: Across | null): Patch {
	// In plain flow only a picture can be moved across, by its margins.
	if (!section) return block.kind === "image" ? ({ align: PICTURE_ALIGN[across ?? "start"] } as Patch) : {};
	const alignSelf = across ?? "auto";
	if (block.kind === "image" && flowOf(section) === "column") {
		const resolved = across ?? (section.layout.align === "stretch" ? "start" : section.layout.align);
		return { alignSelf, align: PICTURE_ALIGN[resolved] } as Patch;
	}
	return { alignSelf } as Patch;
}

/** What the alignment row shows as pressed: nothing while the block is stretched. */
export function acrossOf(block: MailBlock, section: Placer): Across | null {
	if (block.kind === "image" && (!section || flowOf(section) === "column") && block.align !== "left" && block.align !== "justify") {
		return block.align === "center" ? "center" : "end";
	}
	if (!section) return block.kind === "image" ? "start" : null;
	const align = alignOf(block, section);
	return align === "stretch" ? null : align;
}
