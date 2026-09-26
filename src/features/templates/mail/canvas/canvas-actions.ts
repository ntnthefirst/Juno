/**
 * Pure edits over a MailLayout. Every function returns a new layout rather
 * than mutating the one it was given, so the editor's state update is always
 * `setLayout(next)` and React sees a real change.
 *
 * The defaults are duplicated from electron/main/services/mail-layout.ts for
 * the same reason layout-actions.ts duplicates the page margin: the renderer
 * cannot import electron/main (architecture.md section 7). The compiler is
 * still the only thing that turns any of this into HTML, so a value that
 * drifts here shows up as a preview that does not match, not as output nobody
 * checked.
 */
import type {
	MailBlock,
	MailBoxStyle,
	MailEffect,
	MailFill,
	MailLayout,
	MailSection,
	MailSectionLayout,
	MailSides,
	MailSpacing,
	MailTextStyle,
} from "@shared/types";

export function newId(): string {
	return crypto.randomUUID();
}

export function noSpacing(): MailSpacing {
	return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function allSides(): MailSides {
	return { top: true, right: true, bottom: true, left: true };
}

export function emptyBox(): MailBoxStyle {
	return {
		fill: null,
		padding: noSpacing(),
		borderWidth: 0,
		borderColor: null,
		borderStyle: "solid",
		borderSides: allSides(),
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

/** A flat colour as a fill, which is where every fill control starts. */
export function solidFill(color: string): MailFill {
	return { kind: "solid", color, hidden: false };
}

/** The shadow the effects list adds, at values that are visible without being
 * the only thing anybody sees. */
export function newShadow(inset: boolean): MailEffect {
	return { kind: "shadow", inset, x: 0, y: inset ? 1 : 2, blur: 6, spread: 0, color: "#16161d", opacity: 0.2, hidden: false };
}

export function newBlur(): MailEffect {
	return { kind: "blur", radius: 4, hidden: false };
}

export function defaultText(): MailTextStyle {
	return {
		color: null,
		fontFamily: null,
		fontSize: null,
		lineHeight: null,
		letterSpacing: null,
		weight: "normal",
		italic: false,
		decoration: "none",
		transform: "none",
		align: "left",
		verticalAlign: "top",
	};
}

export function stackLayout(): MailSectionLayout {
	return { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false };
}

export function emptySection(name = "Section"): MailSection {
	return { id: newId(), name, hidden: false, alignSelf: "auto", layout: stackLayout(), box: emptyBox(), blocks: [] };
}

/**
 * A section as an author adds one: with room around what goes in it, the way a
 * message's own sections have. `emptySection` stays bare, because it is also
 * what a section is reduced to when the last one is removed, and the room is
 * a choice somebody makes rather than something every section has.
 */
export function newSection(name = "Section"): MailSection {
	return { ...emptySection(name), box: { ...emptyBox(), padding: { top: 24, right: 24, bottom: 24, left: 24 } } };
}

/**
 * What a new template starts from: a frame that fills the mail client, drawn
 * at 600 until a breakpoint says otherwise, and one section with room in it.
 */
export function emptyLayout(): MailLayout {
	return {
		version: 1,
		width: 600,
		widthMode: "fill",
		minHeight: 320,
		fill: null,
		fonts: [],
		customCss: null,
		sections: [newSection("Body")],
		breakpoints: [],
	};
}

export type BlockKind = MailBlock["kind"];

/**
 * What the toolbar inserts. A code block is not on the list: it is what any
 * block becomes with "Convert to HTML", and what the code view puts anything
 * it could not place into, rather than something started empty. Neither is a
 * divider or a spacer: a section with a height, a fill or a stroke on one side
 * is both, and it is one thing to learn instead of three. The two still load
 * and still compile, so a template that has them keeps them.
 */
export const BLOCK_KINDS: BlockKind[] = ["text", "heading", "button", "image", "field"];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
	text: "Text",
	heading: "Heading",
	button: "Button",
	image: "Image",
	field: "Input",
	divider: "Divider",
	spacer: "Spacer",
	html: "HTML",
};

/**
 * Matches newBlock in electron/main/services/mail-layout.ts.
 *
 * A button and a picture hug their content, the way they do in Figma: in a
 * section that stretches what is in it, a button would otherwise be drawn as
 * a bar the width of the message and a picture blown up to it.
 */
export function newBlock(kind: BlockKind): MailBlock {
	const common = { id: newId(), grow: 0, alignSelf: "auto" as const, hidden: false };
	switch (kind) {
		case "heading":
			return {
				...common,
				kind,
				level: 2,
				content: "Titel",
				text: { ...defaultText(), weight: "semibold" },
				box: emptyBox(),
			};
		case "button":
			return {
				...common,
				alignSelf: "start",
				kind,
				label: "Bekijk",
				href: "https://",
				background: "#4a3fa0",
				color: "#ffffff",
				radius: 4,
				text: { ...defaultText(), weight: "semibold", align: "center" },
				box: { ...emptyBox(), padding: { top: 10, right: 18, bottom: 10, left: 18 } },
			};
		case "image":
			return { ...common, alignSelf: "start", kind, src: "", alt: "", width: null, align: "left", box: emptyBox() };
		case "divider":
			return { ...common, kind, color: "#e3e2ec", thickness: 1, box: emptyBox(), grow: 1 };
		case "spacer":
			return { ...common, kind, height: 16 };
		case "field":
			return { ...common, kind, inputKey: "", text: defaultText(), box: emptyBox() };
		case "html":
			return { ...common, kind, html: "", css: "" };
		case "text":
		default:
			return { ...common, kind: "text", html: "Tekst", text: defaultText(), box: emptyBox() };
	}
}

function mapSection(
	layout: MailLayout,
	sectionId: string,
	change: (section: MailSection) => MailSection,
): MailLayout {
	return {
		...layout,
		sections: layout.sections.map((section) => (section.id === sectionId ? change(section) : section)),
	};
}

export function addSection(layout: MailLayout, after?: string): MailLayout {
	const section = newSection(`Section ${layout.sections.length + 1}`);
	if (!after) return { ...layout, sections: [...layout.sections, section] };
	const index = layout.sections.findIndex((entry) => entry.id === after);
	if (index < 0) return { ...layout, sections: [...layout.sections, section] };
	const sections = [...layout.sections];
	sections.splice(index + 1, 0, section);
	return { ...layout, sections };
}

export function updateSection(
	layout: MailLayout,
	sectionId: string,
	patch: Partial<Omit<MailSection, "id" | "blocks">>,
): MailLayout {
	return mapSection(layout, sectionId, (section) => ({ ...section, ...patch }));
}

/**
 * A canvas always has at least one section. Removing the last one would leave
 * nowhere to put a block and no control that puts a section back, which reads
 * as a broken editor rather than as an empty one.
 */
export function removeSection(layout: MailLayout, sectionId: string): MailLayout {
	if (layout.sections.length <= 1) return { ...layout, sections: [emptySection("Body")] };
	return { ...layout, sections: layout.sections.filter((section) => section.id !== sectionId) };
}

export function moveSection(layout: MailLayout, sectionId: string, by: -1 | 1): MailLayout {
	const index = layout.sections.findIndex((section) => section.id === sectionId);
	const target = index + by;
	if (index < 0 || target < 0 || target >= layout.sections.length) return layout;
	const sections = [...layout.sections];
	const [moved] = sections.splice(index, 1);
	if (moved) sections.splice(target, 0, moved);
	return { ...layout, sections };
}

/**
 * Moves a section to in front of another, or to the end when that is null.
 * What dragging a section in the layers does.
 */
export function moveSectionTo(layout: MailLayout, sectionId: string, beforeSectionId: string | null): MailLayout {
	if (sectionId === beforeSectionId) return layout;
	const moving = layout.sections.find((section) => section.id === sectionId);
	if (!moving) return layout;
	const rest = layout.sections.filter((section) => section.id !== sectionId);
	const index = beforeSectionId === null ? -1 : rest.findIndex((section) => section.id === beforeSectionId);
	if (index < 0) return { ...layout, sections: [...rest, moving] };
	return { ...layout, sections: [...rest.slice(0, index), moving, ...rest.slice(index)] };
}

export function addBlock(layout: MailLayout, sectionId: string, block: MailBlock): MailLayout {
	return mapSection(layout, sectionId, (section) => ({ ...section, blocks: [...section.blocks, block] }));
}

export function updateBlock(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
	patch: Partial<MailBlock>,
): MailLayout {
	return mapSection(layout, sectionId, (section) => ({
		...section,
		blocks: section.blocks.map((block) =>
			// The cast holds because a patch only ever carries fields of the block
			// it came from: the inspector builds it from the selected block, so
			// there is no path that puts a heading's level onto a spacer.
			block.id === blockId ? ({ ...block, ...patch } as MailBlock) : block,
		),
	}));
}

export function removeBlock(layout: MailLayout, sectionId: string, blockId: string): MailLayout {
	return mapSection(layout, sectionId, (section) => ({
		...section,
		blocks: section.blocks.filter((block) => block.id !== blockId),
	}));
}

export function moveBlock(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
	by: -1 | 1,
): MailLayout {
	return mapSection(layout, sectionId, (section) => {
		const index = section.blocks.findIndex((block) => block.id === blockId);
		const target = index + by;
		if (index < 0 || target < 0 || target >= section.blocks.length) return section;
		const blocks = [...section.blocks];
		const [moved] = blocks.splice(index, 1);
		if (moved) blocks.splice(target, 0, moved);
		return { ...section, blocks };
	});
}

/** Moves a block into another section, at the end of it. */
export function reparentBlock(
	layout: MailLayout,
	fromSectionId: string,
	toSectionId: string,
	blockId: string,
): MailLayout {
	if (fromSectionId === toSectionId) return layout;
	const block = layout.sections
		.find((section) => section.id === fromSectionId)
		?.blocks.find((entry) => entry.id === blockId);
	if (!block) return layout;
	return addBlock(removeBlock(layout, fromSectionId, blockId), toSectionId, block);
}

/**
 * Drops a block where it was let go: in front of `beforeBlockId`, or at the
 * end of the section when that is null.
 *
 * `reparentBlock` is the same move with nowhere in particular to land, and it
 * stays, because appending is exactly what a drop onto a section's empty space
 * means.
 */
export function dropBlock(
	layout: MailLayout,
	fromSectionId: string,
	toSectionId: string,
	blockId: string,
	beforeBlockId: string | null,
): MailLayout {
	if (blockId === beforeBlockId) return layout;
	const block = layout.sections
		.find((section) => section.id === fromSectionId)
		?.blocks.find((entry) => entry.id === blockId);
	if (!block) return layout;
	const without = removeBlock(layout, fromSectionId, blockId);
	if (!beforeBlockId) return addBlock(without, toSectionId, block);
	return mapSection(without, toSectionId, (section) => {
		const index = section.blocks.findIndex((entry) => entry.id === beforeBlockId);
		if (index < 0) return { ...section, blocks: [...section.blocks, block] };
		const blocks = [...section.blocks];
		blocks.splice(index, 0, block);
		return { ...section, blocks };
	});
}

export function findBlock(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
): MailBlock | null {
	return (
		layout.sections.find((section) => section.id === sectionId)?.blocks.find((block) => block.id === blockId) ??
		null
	);
}

/* ------------------------------------------------ copying, pasting, stepping */

type Scope = { sectionId: string; blockId?: string } | null;

/** A copy of a block with an id of its own, which is what a paste or a duplicate puts down. */
export function cloneBlock(block: MailBlock): MailBlock {
	return { ...structuredClone(block), id: newId() };
}

/** A copy of a section and everything in it, every id new. */
export function cloneSection(section: MailSection): MailSection {
	return { ...structuredClone(section), id: newId(), blocks: section.blocks.map(cloneBlock) };
}

/**
 * Puts a block straight after another in its section, or at the end of the
 * section when that is null or not there, which is where Figma pastes: next to
 * what is selected, inside the same parent.
 */
export function insertBlockAfter(
	layout: MailLayout,
	sectionId: string,
	afterBlockId: string | null,
	block: MailBlock,
): MailLayout {
	return mapSection(layout, sectionId, (section) => {
		const index = afterBlockId ? section.blocks.findIndex((entry) => entry.id === afterBlockId) : -1;
		if (index < 0) return { ...section, blocks: [...section.blocks, block] };
		const blocks = [...section.blocks];
		blocks.splice(index + 1, 0, block);
		return { ...section, blocks };
	});
}

/** Puts a section straight after another, or at the end. */
export function insertSectionAfter(layout: MailLayout, afterSectionId: string | null, section: MailSection): MailLayout {
	const index = afterSectionId ? layout.sections.findIndex((entry) => entry.id === afterSectionId) : -1;
	if (index < 0) return { ...layout, sections: [...layout.sections, section] };
	const sections = [...layout.sections];
	sections.splice(index + 1, 0, section);
	return { ...layout, sections };
}

/** Whether what is selected is still there, which an undo can change under it. */
export function selectionIn(layout: MailLayout, scope: Scope): boolean {
	if (!scope) return true;
	const section = layout.sections.find((entry) => entry.id === scope.sectionId);
	if (!section) return false;
	return !scope.blockId || section.blocks.some((block) => block.id === scope.blockId);
}

/**
 * The next or the previous layer beside what is selected, going round at the
 * ends: Tab and Shift+Tab in Figma. A block steps among the blocks of its
 * section, a section among the sections.
 */
export function siblingOf(layout: MailLayout, scope: NonNullable<Scope>, by: -1 | 1): NonNullable<Scope> {
	const section = layout.sections.find((entry) => entry.id === scope.sectionId);
	if (!section) return scope;
	if (scope.blockId) {
		const index = section.blocks.findIndex((block) => block.id === scope.blockId);
		const count = section.blocks.length;
		const next = section.blocks[(index + by + count) % count];
		return next ? { sectionId: section.id, blockId: next.id } : scope;
	}
	const index = layout.sections.findIndex((entry) => entry.id === section.id);
	const count = layout.sections.length;
	const next = layout.sections[(index + by + count) % count];
	return next ? { sectionId: next.id } : scope;
}

/* --------------------------------------------------------- selection colours */

function textColors(text: MailTextStyle): (string | null)[] {
	return [text.color];
}

function boxColors(box: MailBoxStyle): (string | null)[] {
	return [
		box.fill?.kind === "solid" ? box.fill.color : null,
		box.fill?.kind === "gradient" ? box.fill.from : null,
		box.fill?.kind === "gradient" ? box.fill.to : null,
		box.borderWidth > 0 ? box.borderColor : null,
		...box.effects.map((effect) => (effect.kind === "shadow" ? effect.color : null)),
	];
}

function blockColors(block: MailBlock): (string | null)[] {
	switch (block.kind) {
		case "button":
			return [block.background, block.color, ...boxColors(block.box)];
		case "divider":
			return [block.color, ...boxColors(block.box)];
		case "spacer":
		case "html":
			return [];
		default:
			return ["text" in block ? textColors(block.text) : [], boxColors(block.box)].flat();
	}
}

function sectionColors(section: MailSection): (string | null)[] {
	return [...boxColors(section.box), ...section.blocks.flatMap(blockColors)];
}

/**
 * Every colour used in what is selected, or in the whole message when nothing
 * is: Figma's selection colours. Lowercased, so `#FFF` and `#fff` are one
 * swatch, and in the order they first appear.
 */
export function colorsIn(layout: MailLayout, scope: Scope): string[] {
	const section = scope ? layout.sections.find((entry) => entry.id === scope.sectionId) : undefined;
	const block = section && scope?.blockId ? section.blocks.find((entry) => entry.id === scope.blockId) : undefined;
	const found = block
		? blockColors(block)
		: section
			? sectionColors(section)
			: [
					layout.fill?.kind === "solid" ? layout.fill.color : null,
					layout.fill?.kind === "gradient" ? layout.fill.from : null,
					layout.fill?.kind === "gradient" ? layout.fill.to : null,
					...layout.sections.flatMap(sectionColors),
				];
	return [...new Set(found.filter((color): color is string => Boolean(color)).map((color) => color.toLowerCase()))];
}

function swap(color: string, from: string, to: string): string {
	return color.toLowerCase() === from ? to : color;
}

function swapNullable(color: string | null, from: string, to: string): string | null {
	return color === null ? null : swap(color, from, to);
}

function recolorBox(box: MailBoxStyle, from: string, to: string): MailBoxStyle {
	const fill =
		box.fill?.kind === "solid"
			? { ...box.fill, color: swap(box.fill.color, from, to) }
			: box.fill?.kind === "gradient"
				? { ...box.fill, from: swap(box.fill.from, from, to), to: swap(box.fill.to, from, to) }
				: null;
	return {
		...box,
		fill,
		borderColor: swapNullable(box.borderColor, from, to),
		effects: box.effects.map((effect) =>
			effect.kind === "shadow" ? { ...effect, color: swap(effect.color, from, to) } : effect,
		),
	};
}

function recolorBlock(block: MailBlock, from: string, to: string): MailBlock {
	switch (block.kind) {
		case "button":
			return {
				...block,
				background: swap(block.background, from, to),
				color: swap(block.color, from, to),
				box: recolorBox(block.box, from, to),
			};
		case "divider":
			return { ...block, color: swap(block.color, from, to), box: recolorBox(block.box, from, to) };
		case "spacer":
		case "html":
			// A code block's colours are in its code, where they are edited.
			return block;
		case "image":
			return { ...block, box: recolorBox(block.box, from, to) };
		default:
			return {
				...block,
				text: { ...block.text, color: swapNullable(block.text.color, from, to) },
				box: recolorBox(block.box, from, to),
			};
	}
}

function recolorSection(section: MailSection, from: string, to: string): MailSection {
	return {
		...section,
		box: recolorBox(section.box, from, to),
		blocks: section.blocks.map((block) => recolorBlock(block, from, to)),
	};
}

/**
 * Changes one colour to another everywhere in what is selected, the way
 * Figma's selection colours do. Nothing outside the selection is touched.
 */
export function replaceColor(layout: MailLayout, scope: Scope, from: string, to: string): MailLayout {
	const match = from.toLowerCase();
	if (!scope) {
		const fill =
			layout.fill?.kind === "solid"
				? { ...layout.fill, color: swap(layout.fill.color, match, to) }
				: layout.fill?.kind === "gradient"
					? { ...layout.fill, from: swap(layout.fill.from, match, to), to: swap(layout.fill.to, match, to) }
					: null;
		return { ...layout, fill, sections: layout.sections.map((section) => recolorSection(section, match, to)) };
	}
	return mapSection(layout, scope.sectionId, (section) =>
		scope.blockId
			? {
					...section,
					blocks: section.blocks.map((block) => (block.id === scope.blockId ? recolorBlock(block, match, to) : block)),
				}
			: recolorSection(section, match, to),
	);
}
