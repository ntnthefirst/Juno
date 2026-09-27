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
	MailContainer,
	MailEffect,
	MailFill,
	MailLayout,
	MailNode,
	MailSectionLayout,
	MailSides,
	MailSpacing,
	MailTextStyle,
} from "@shared/types";

/** A container is a section, in the shapes this phase can build: any node holding others. */
function isContainer(node: MailNode): node is MailContainer {
	return node.kind === "container";
}

/** A leaf: anything that is not a container or a columns table. */
function isBlockNode(node: MailNode): node is MailBlock {
	return node.kind !== "container" && node.kind !== "columns";
}

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

/**
 * A container with nothing in it: what every section is, generalised to every
 * tag the toolbar can add. Phase 1 of the tool-per-element work
 * (`docs/editors.md` section 2) only ever creates a `section`, which is what
 * the current toolbar and layers still call one.
 */
export function emptySection(name = "Section"): MailContainer {
	return {
		id: newId(),
		kind: "container",
		tag: "section",
		name,
		hidden: false,
		alignSelf: "auto",
		grow: 0,
		layout: stackLayout(),
		box: emptyBox(),
		children: [],
	};
}

/**
 * A section as an author adds one: with room around what goes in it, the way a
 * message's own sections have. `emptySection` stays bare, because it is also
 * what a section is reduced to when the last one is removed, and the room is
 * a choice somebody makes rather than something every section has.
 */
export function newSection(name = "Section"): MailContainer {
	return { ...emptySection(name), box: { ...emptyBox(), padding: { top: 24, right: 24, bottom: 24, left: 24 } } };
}

/**
 * What a new template starts from: a frame that fills the mail client, drawn
 * at 600 until a breakpoint says otherwise, and one section with room in it.
 */
export function emptyLayout(): MailLayout {
	return {
		version: 2,
		width: 600,
		widthMode: "fill",
		minHeight: 320,
		fill: null,
		fonts: [],
		customCss: null,
		children: [newSection("Body")],
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
				tag: "h2",
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
			return { ...common, alignSelf: "start", kind, src: "", alt: "", width: null, align: "left", href: null, box: emptyBox() };
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
			return { ...common, kind: "text", tag: "p", html: "Tekst", text: defaultText(), box: emptyBox() };
	}
}

/**
 * Finds a top-level section by id and replaces it with `change`'s result.
 *
 * Phase 1 of the tool-per-element work only ever nests a section at the top
 * level, so every editing action here still works one level deep, on
 * `layout.children` and a section's own `children`. Real nesting, dragging
 * into and out of a container, and editing a columns table are phase 2 and 3
 * (`docs/editors.md` section 2).
 */
function mapSection(
	layout: MailLayout,
	sectionId: string,
	change: (section: MailContainer) => MailContainer,
): MailLayout {
	return {
		...layout,
		children: layout.children.map((node) => (isContainer(node) && node.id === sectionId ? change(node) : node)),
	};
}

function sections(layout: MailLayout): MailContainer[] {
	return layout.children.filter(isContainer);
}

export function addSection(layout: MailLayout, after?: string): MailLayout {
	const section = newSection(`Section ${sections(layout).length + 1}`);
	if (!after) return { ...layout, children: [...layout.children, section] };
	const index = layout.children.findIndex((node) => node.id === after);
	if (index < 0) return { ...layout, children: [...layout.children, section] };
	const children = [...layout.children];
	children.splice(index + 1, 0, section);
	return { ...layout, children };
}

export function updateSection(
	layout: MailLayout,
	sectionId: string,
	patch: Partial<Omit<MailContainer, "id" | "kind" | "children">>,
): MailLayout {
	return mapSection(layout, sectionId, (section) => ({ ...section, ...patch }));
}

/**
 * A canvas always has at least one section. Removing the last one would leave
 * nowhere to put a block and no control that puts a section back, which reads
 * as a broken editor rather than as an empty one.
 */
export function removeSection(layout: MailLayout, sectionId: string): MailLayout {
	if (sections(layout).length <= 1) return { ...layout, children: [emptySection("Body")] };
	return { ...layout, children: layout.children.filter((node) => node.id !== sectionId) };
}

export function moveSection(layout: MailLayout, sectionId: string, by: -1 | 1): MailLayout {
	const index = layout.children.findIndex((node) => node.id === sectionId);
	const target = index + by;
	if (index < 0 || target < 0 || target >= layout.children.length) return layout;
	const children = [...layout.children];
	const [moved] = children.splice(index, 1);
	if (moved) children.splice(target, 0, moved);
	return { ...layout, children };
}

/**
 * Moves a section to in front of another, or to the end when that is null.
 * What dragging a section in the layers does.
 */
export function moveSectionTo(layout: MailLayout, sectionId: string, beforeSectionId: string | null): MailLayout {
	if (sectionId === beforeSectionId) return layout;
	const moving = layout.children.find((node) => node.id === sectionId);
	if (!moving) return layout;
	const rest = layout.children.filter((node) => node.id !== sectionId);
	const index = beforeSectionId === null ? -1 : rest.findIndex((node) => node.id === beforeSectionId);
	if (index < 0) return { ...layout, children: [...rest, moving] };
	return { ...layout, children: [...rest.slice(0, index), moving, ...rest.slice(index)] };
}

export function addBlock(layout: MailLayout, sectionId: string, block: MailBlock): MailLayout {
	return mapSection(layout, sectionId, (section) => ({ ...section, children: [...section.children, block] }));
}

export function updateBlock(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
	patch: Partial<MailBlock>,
): MailLayout {
	return mapSection(layout, sectionId, (section) => ({
		...section,
		children: section.children.map((node) =>
			// The cast holds because a patch only ever carries fields of the block
			// it came from: the inspector builds it from the selected block, so
			// there is no path that puts a heading's tag onto a spacer.
			node.id === blockId && isBlockNode(node) ? ({ ...node, ...patch } as MailBlock) : node,
		),
	}));
}

export function removeBlock(layout: MailLayout, sectionId: string, blockId: string): MailLayout {
	return mapSection(layout, sectionId, (section) => ({
		...section,
		children: section.children.filter((node) => node.id !== blockId),
	}));
}

export function moveBlock(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
	by: -1 | 1,
): MailLayout {
	return mapSection(layout, sectionId, (section) => {
		const index = section.children.findIndex((node) => node.id === blockId);
		const target = index + by;
		if (index < 0 || target < 0 || target >= section.children.length) return section;
		const children = [...section.children];
		const [moved] = children.splice(index, 1);
		if (moved) children.splice(target, 0, moved);
		return { ...section, children };
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
	const block = sections(layout)
		.find((section) => section.id === fromSectionId)
		?.children.find((entry): entry is MailBlock => entry.id === blockId && isBlockNode(entry));
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
	const block = sections(layout)
		.find((section) => section.id === fromSectionId)
		?.children.find((entry): entry is MailBlock => entry.id === blockId && isBlockNode(entry));
	if (!block) return layout;
	const without = removeBlock(layout, fromSectionId, blockId);
	if (!beforeBlockId) return addBlock(without, toSectionId, block);
	return mapSection(without, toSectionId, (section) => {
		const index = section.children.findIndex((entry) => entry.id === beforeBlockId);
		if (index < 0) return { ...section, children: [...section.children, block] };
		const children = [...section.children];
		children.splice(index, 0, block);
		return { ...section, children };
	});
}

export function findBlock(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
): MailBlock | null {
	const section = sections(layout).find((entry) => entry.id === sectionId);
	const block = section?.children.find((entry) => entry.id === blockId);
	return block && isBlockNode(block) ? block : null;
}

/* ------------------------------------------------ copying, pasting, stepping */

type Scope = { sectionId: string; blockId?: string } | null;

/** A copy of a block with an id of its own, which is what a paste or a duplicate puts down. */
export function cloneBlock(block: MailBlock): MailBlock {
	return { ...structuredClone(block), id: newId() };
}

/**
 * A copy of a node and everything in it, every id new. Recurses through a
 * container's or a columns table's children, so a copy of anything the model
 * allows is safe to make even where phase 1 offers no way to build one.
 */
function cloneNode(node: MailNode): MailNode {
	if (isContainer(node)) {
		return { ...structuredClone(node), id: newId(), children: node.children.map(cloneNode) };
	}
	if (node.kind === "columns") {
		return {
			...structuredClone(node),
			id: newId(),
			rows: node.rows.map((row) => ({
				...structuredClone(row),
				id: newId(),
				cells: row.cells.map((cell) => ({
					...structuredClone(cell),
					id: newId(),
					children: cell.children.map(cloneNode),
				})),
			})),
		};
	}
	return cloneBlock(node);
}

/** A copy of a section and everything in it, every id new. */
export function cloneSection(section: MailContainer): MailContainer {
	return cloneNode(section) as MailContainer;
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
		const index = afterBlockId ? section.children.findIndex((entry) => entry.id === afterBlockId) : -1;
		if (index < 0) return { ...section, children: [...section.children, block] };
		const children = [...section.children];
		children.splice(index + 1, 0, block);
		return { ...section, children };
	});
}

/** Puts a section straight after another, or at the end. */
export function insertSectionAfter(layout: MailLayout, afterSectionId: string | null, section: MailContainer): MailLayout {
	const index = afterSectionId ? layout.children.findIndex((entry) => entry.id === afterSectionId) : -1;
	if (index < 0) return { ...layout, children: [...layout.children, section] };
	const children = [...layout.children];
	children.splice(index + 1, 0, section);
	return { ...layout, children };
}

/** Whether what is selected is still there, which an undo can change under it. */
export function selectionIn(layout: MailLayout, scope: Scope): boolean {
	if (!scope) return true;
	const section = sections(layout).find((entry) => entry.id === scope.sectionId);
	if (!section) return false;
	return !scope.blockId || section.children.some((node) => node.id === scope.blockId);
}

/**
 * The next or the previous layer beside what is selected, going round at the
 * ends: Tab and Shift+Tab in Figma. A block steps among the blocks of its
 * section, a section among the sections.
 */
export function siblingOf(layout: MailLayout, scope: NonNullable<Scope>, by: -1 | 1): NonNullable<Scope> {
	const section = sections(layout).find((entry) => entry.id === scope.sectionId);
	if (!section) return scope;
	if (scope.blockId) {
		const index = section.children.findIndex((node) => node.id === scope.blockId);
		const count = section.children.length;
		const next = section.children[(index + by + count) % count];
		return next ? { sectionId: section.id, blockId: next.id } : scope;
	}
	const siblings = sections(layout);
	const index = siblings.findIndex((entry) => entry.id === section.id);
	const count = siblings.length;
	const next = siblings[(index + by + count) % count];
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

/** A node's own colours, and everything nested under it: a container's or a columns table's children too. */
function nodeColors(node: MailNode): (string | null)[] {
	if (isContainer(node)) return [...boxColors(node.box), ...node.children.flatMap(nodeColors)];
	if (node.kind === "columns") {
		return [...boxColors(node.box), ...node.rows.flatMap((row) => row.cells.flatMap((cell) => cell.children.flatMap(nodeColors)))];
	}
	return blockColors(node);
}

function sectionColors(section: MailContainer): (string | null)[] {
	return nodeColors(section);
}

/**
 * Every colour used in what is selected, or in the whole message when nothing
 * is: Figma's selection colours. Lowercased, so `#FFF` and `#fff` are one
 * swatch, and in the order they first appear.
 */
export function colorsIn(layout: MailLayout, scope: Scope): string[] {
	const section = scope ? sections(layout).find((entry) => entry.id === scope.sectionId) : undefined;
	const block = section && scope?.blockId ? section.children.find((entry) => entry.id === scope.blockId) : undefined;
	const found =
		block && isBlockNode(block)
			? blockColors(block)
			: section
				? sectionColors(section)
				: [
						layout.fill?.kind === "solid" ? layout.fill.color : null,
						layout.fill?.kind === "gradient" ? layout.fill.from : null,
						layout.fill?.kind === "gradient" ? layout.fill.to : null,
						...layout.children.flatMap(nodeColors),
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

function recolorNode(node: MailNode, from: string, to: string): MailNode {
	if (isContainer(node)) {
		return { ...node, box: recolorBox(node.box, from, to), children: node.children.map((child) => recolorNode(child, from, to)) };
	}
	if (node.kind === "columns") {
		return {
			...node,
			box: recolorBox(node.box, from, to),
			rows: node.rows.map((row) => ({
				...row,
				cells: row.cells.map((cell) => ({
					...cell,
					box: recolorBox(cell.box, from, to),
					children: cell.children.map((child) => recolorNode(child, from, to)),
				})),
			})),
		};
	}
	return recolorBlock(node, from, to);
}

function recolorSection(section: MailContainer, from: string, to: string): MailContainer {
	return recolorNode(section, from, to) as MailContainer;
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
		return { ...layout, fill, children: layout.children.map((node) => recolorNode(node, match, to)) };
	}
	return mapSection(layout, scope.sectionId, (section) =>
		scope.blockId
			? {
					...section,
					children: section.children.map((node) => (node.id === scope.blockId ? recolorNode(node, match, to) : node)),
				}
			: recolorSection(section, match, to),
	);
}
