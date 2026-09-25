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
	MailLayout,
	MailSection,
	MailSectionLayout,
	MailSpacing,
	MailTextStyle,
} from "@shared/types";

export function newId(): string {
	return crypto.randomUUID();
}

export function noSpacing(): MailSpacing {
	return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function emptyBox(): MailBoxStyle {
	return {
		background: null,
		padding: noSpacing(),
		borderWidth: 0,
		borderColor: null,
		borderRadius: 0,
		customCss: null,
	};
}

export function defaultText(): MailTextStyle {
	return { color: null, fontSize: null, lineHeight: null, weight: "normal", align: "left" };
}

export function stackLayout(): MailSectionLayout {
	return { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false };
}

export function emptySection(name = "Section"): MailSection {
	return { id: newId(), name, layout: stackLayout(), box: emptyBox(), blocks: [] };
}

/** What "Lay this out on a canvas" creates: the frame, and nothing in it. */
export function emptyLayout(): MailLayout {
	return {
		version: 1,
		width: 600,
		minHeight: 320,
		background: null,
		customCss: null,
		sections: [emptySection("Body")],
	};
}

export type BlockKind = MailBlock["kind"];

export const BLOCK_KINDS: BlockKind[] = [
	"text",
	"heading",
	"button",
	"image",
	"field",
	"divider",
	"spacer",
	"html",
];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
	text: "Text",
	heading: "Heading",
	button: "Button",
	image: "Image",
	field: "Input",
	divider: "Divider",
	spacer: "Spacer",
	html: "Raw HTML",
};

/** Matches newBlock in electron/main/services/mail-layout.ts. */
export function newBlock(kind: BlockKind): MailBlock {
	const id = newId();
	switch (kind) {
		case "heading":
			return {
				id,
				kind,
				level: 2,
				content: "Titel",
				text: { ...defaultText(), weight: "semibold" },
				box: emptyBox(),
				grow: 0,
			};
		case "button":
			return {
				id,
				kind,
				label: "Bekijk",
				href: "https://",
				background: "#4a3fa0",
				color: "#ffffff",
				radius: 4,
				box: { ...emptyBox(), padding: { top: 10, right: 18, bottom: 10, left: 18 } },
				grow: 0,
			};
		case "image":
			return { id, kind, src: "", alt: "", width: null, align: "left", box: emptyBox(), grow: 0 };
		case "divider":
			return { id, kind, color: "#e3e2ec", thickness: 1, box: emptyBox(), grow: 1 };
		case "spacer":
			return { id, kind, height: 16, grow: 0 };
		case "field":
			return { id, kind, inputKey: "", text: defaultText(), box: emptyBox(), grow: 0 };
		case "html":
			return { id, kind, html: "", box: emptyBox(), grow: 0 };
		case "text":
		default:
			return { id, kind: "text", html: "Tekst", text: defaultText(), box: emptyBox(), grow: 0 };
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
	const section = emptySection(`Section ${layout.sections.length + 1}`);
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
