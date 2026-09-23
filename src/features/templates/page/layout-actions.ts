/**
 * Pure edits over a DocumentLayout. Every function returns a new layout
 * rather than mutating the one it was given, so the editor's state update is
 * always `setLayout(next)` and React sees a real change.
 *
 * The default margin is duplicated from
 * electron/main/services/document-layout.ts for the same reason the A4 size
 * is duplicated in page-geometry.ts: the renderer cannot import electron/main
 * (architecture.md section 7).
 */
import type { DocumentLayout, LayoutAlign, LayoutBlock, LayoutBox, LayoutPage, PageMargin } from "@shared/types";
import { A4_WIDTH_MM } from "../../../lib/page-geometry";

/** Matches DEFAULT_MARGIN in electron/main/services/document-layout.ts. */
export const DEFAULT_MARGIN: PageMargin = { top: 24, right: 20, bottom: 22, left: 20 };

export function newId(): string {
	return crypto.randomUUID();
}

export function emptyPage(): LayoutPage {
	return { id: newId(), blocks: [], boxes: [] };
}

/** What "Start a page layout" creates: one blank page, nothing carried over. */
export function emptyLayout(): DocumentLayout {
	return { version: 1, pageSize: "A4", margin: { ...DEFAULT_MARGIN }, pages: [emptyPage()] };
}

export type BlockKind = LayoutBlock["kind"];

export const BLOCK_KINDS: BlockKind[] = [
	"heading",
	"paragraph",
	"list",
	"image",
	"spacer",
	"divider",
	"table",
	"signature",
];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
	heading: "Heading",
	paragraph: "Paragraph",
	list: "List",
	image: "Image",
	spacer: "Spacer",
	divider: "Divider",
	table: "Table",
	signature: "Signature area",
};

const DEFAULT_ALIGN: LayoutAlign = "left";

export function newBlock(kind: BlockKind): LayoutBlock {
	const id = newId();
	switch (kind) {
		case "heading":
			return { id, kind, level: 2, text: "", align: DEFAULT_ALIGN };
		case "paragraph":
			return { id, kind, html: "", align: DEFAULT_ALIGN };
		case "list":
			return { id, kind, ordered: false, items: [""] };
		case "image":
			return { id, kind, src: "", alt: "", widthMm: 60, align: DEFAULT_ALIGN };
		case "spacer":
			return { id, kind, heightMm: 10 };
		case "divider":
			return { id, kind };
		case "table":
			return {
				id,
				kind,
				columns: [
					{ header: "", widthPct: 50 },
					{ header: "", widthPct: 50 },
				],
				rows: [["", ""]],
				headerRow: true,
			};
		case "signature":
			return { id, kind, label: "", widthMm: 70 };
	}
}

export function newBox(kind: BlockKind): LayoutBox {
	return { id: newId(), xMm: 20, yMm: 20, widthMm: Math.min(80, A4_WIDTH_MM - 40), block: newBlock(kind) };
}

function mapPage(layout: DocumentLayout, pageId: string, fn: (page: LayoutPage) => LayoutPage): DocumentLayout {
	return { ...layout, pages: layout.pages.map((page) => (page.id === pageId ? fn(page) : page)) };
}

export function addBlock(layout: DocumentLayout, pageId: string, block: LayoutBlock): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({ ...page, blocks: [...page.blocks, block] }));
}

export function addBox(layout: DocumentLayout, pageId: string, box: LayoutBox): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({ ...page, boxes: [...page.boxes, box] }));
}

export function updateBlock(
	layout: DocumentLayout,
	pageId: string,
	blockId: string,
	patch: Partial<LayoutBlock>,
): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({
		...page,
		blocks: page.blocks.map((block) =>
			block.id === blockId ? ({ ...block, ...patch } as LayoutBlock) : block,
		),
	}));
}

export function updateBox(
	layout: DocumentLayout,
	pageId: string,
	boxId: string,
	patch: Partial<Omit<LayoutBox, "block" | "id">>,
): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({
		...page,
		boxes: page.boxes.map((box) => (box.id === boxId ? { ...box, ...patch } : box)),
	}));
}

export function updateBoxBlock(
	layout: DocumentLayout,
	pageId: string,
	boxId: string,
	patch: Partial<LayoutBlock>,
): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({
		...page,
		boxes: page.boxes.map((box) =>
			box.id === boxId ? { ...box, block: { ...box.block, ...patch } as LayoutBlock } : box,
		),
	}));
}

export function removeBlock(layout: DocumentLayout, pageId: string, blockId: string): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({
		...page,
		blocks: page.blocks.filter((block) => block.id !== blockId),
	}));
}

export function removeBox(layout: DocumentLayout, pageId: string, boxId: string): DocumentLayout {
	return mapPage(layout, pageId, (page) => ({ ...page, boxes: page.boxes.filter((box) => box.id !== boxId) }));
}

export function moveBlock(
	layout: DocumentLayout,
	pageId: string,
	blockId: string,
	direction: -1 | 1,
): DocumentLayout {
	return mapPage(layout, pageId, (page) => {
		const index = page.blocks.findIndex((block) => block.id === blockId);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= page.blocks.length) return page;
		const blocks = [...page.blocks];
		const moved = blocks[index]!;
		blocks.splice(index, 1);
		blocks.splice(target, 0, moved);
		return { ...page, blocks };
	});
}

export function addPage(layout: DocumentLayout): DocumentLayout {
	return { ...layout, pages: [...layout.pages, emptyPage()] };
}

/** A layout cannot show nothing, so the caller only offers this when there
 * is more than one page: the last one is never removable here. */
export function removePage(layout: DocumentLayout, pageId: string): DocumentLayout {
	if (layout.pages.length <= 1) return layout;
	return { ...layout, pages: layout.pages.filter((page) => page.id !== pageId) };
}
