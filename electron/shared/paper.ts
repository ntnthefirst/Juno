/**
 * Paper for document templates: the sizes, and the rules that keep a canvas
 * laid out on them.
 *
 * Shared by the main process, which normalises every canvas it stores and
 * prints, and the renderer, which normalises the canvas it draws, so a page
 * cannot be one size on screen and another on paper. Pure on purpose: no node
 * import, no DOM.
 */
import type {
	DocumentCanvas,
	DocumentPaper,
	MailBoxStyle,
	MailContainer,
	MailLayout,
	MailNode,
	PaperOrientation,
	PaperSize,
} from "./types";

/** Portrait width and height in millimetres. */
export const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
	A3: { width: 297, height: 420 },
	A4: { width: 210, height: 297 },
	A5: { width: 148, height: 210 },
	A6: { width: 105, height: 148 },
	letter: { width: 215.9, height: 279.4 },
	legal: { width: 215.9, height: 355.6 },
};

export const PAPER_SIZES = Object.keys(PAPER_MM) as PaperSize[];

export const PAPER_LABELS: Record<PaperSize, string> = {
	A3: "A3",
	A4: "A4",
	A5: "A5",
	A6: "A6",
	letter: "Letter",
	legal: "Legal",
};

/** CSS pixels per millimetre. A printer and a browser both take an inch as 96 pixels. */
export const PX_PER_MM = 96 / 25.4;

/**
 * Room the canvas leaves under each page, so two pages read as two sheets. It
 * is a margin on the page in the stored canvas and is taken off before printing.
 */
export const PAGE_GAP = 32;

/** The margin a new page starts with, in pixels: 20 millimetres, rounded. */
export const DEFAULT_PAGE_PADDING = 76;

export const DEFAULT_PAPER: DocumentPaper = { size: "A4", orientation: "portrait" };

export function toPaper(raw: unknown): DocumentPaper {
	const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const size = PAPER_SIZES.includes(value.size as PaperSize) ? (value.size as PaperSize) : DEFAULT_PAPER.size;
	const orientation: PaperOrientation = value.orientation === "landscape" ? "landscape" : "portrait";
	return { size, orientation };
}

/** The paper's width and height in millimetres, turned for its orientation. */
export function paperMm(paper: DocumentPaper): { width: number; height: number } {
	const { width, height } = PAPER_MM[paper.size];
	return paper.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/** The paper in whole pixels, which is what the canvas draws a page at. */
export function paperPx(paper: DocumentPaper): { width: number; height: number } {
	const mm = paperMm(paper);
	return { width: Math.round(mm.width * PX_PER_MM), height: Math.round(mm.height * PX_PER_MM) };
}

export function paperLabel(paper: DocumentPaper): string {
	const mm = paperMm(paper);
	const round = (value: number) => Math.round(value * 10) / 10;
	return `${PAPER_LABELS[paper.size]} ${paper.orientation}, ${round(mm.width)} x ${round(mm.height)} mm`;
}

function pageBox(paper: DocumentPaper, box?: MailBoxStyle): MailBoxStyle {
	const { width, height } = paperPx(paper);
	const base: MailBoxStyle = box ?? {
		fill: { kind: "solid", color: "#ffffff", hidden: false },
		padding: {
			top: DEFAULT_PAGE_PADDING,
			right: DEFAULT_PAGE_PADDING,
			bottom: DEFAULT_PAGE_PADDING,
			left: DEFAULT_PAGE_PADDING,
		},
		margin: { top: 0, right: 0, bottom: 0, left: 0 },
		borderWidth: 0,
		borderColor: null,
		borderStyle: "solid",
		borderSides: { top: true, right: true, bottom: true, left: true },
		strokeHidden: false,
		borderRadius: 0,
		corners: null,
		opacity: 1,
		effects: [],
		width: null,
		minHeight: null,
		clip: true,
		customCss: null,
	};
	// A page is the paper. Its size, its place and its clip are not the
	// author's to change; its margin (padding), fill and everything else are.
	return {
		...base,
		width,
		minHeight: height,
		clip: true,
		margin: { top: 0, right: 0, bottom: PAGE_GAP, left: 0 },
		borderRadius: 0,
		corners: null,
	};
}

/** A new, empty page for this paper. */
export function newPage(paper: DocumentPaper, name = "Page"): MailContainer {
	return {
		id: globalThis.crypto.randomUUID(),
		kind: "container",
		tag: "section",
		hidden: false,
		name,
		alignSelf: "auto",
		grow: 0,
		layout: { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false },
		box: pageBox(paper),
		actions: [],
		children: [],
	};
}

/** An empty canvas: one page of the given paper. */
export function emptyCanvas(paper: DocumentPaper = DEFAULT_PAPER): DocumentCanvas {
	return normaliseCanvas({
		version: 1,
		paper,
		layout: {
			version: 2,
			width: 0,
			widthMode: "fixed",
			minHeight: 0,
			fill: null,
			fonts: [],
			customCss: null,
			children: [newPage(paper, "Page 1")],
			breakpoints: [],
		},
	});
}

/**
 * Holds a canvas to the shape a sheet of paper has, whoever wrote it.
 *
 * - The frame is the paper's width, fixed, with nothing behind the pages and
 *   no breakpoints: paper has one width.
 * - Every top-level node is a page. A container at the top level becomes one,
 *   sized to the paper. Anything else at the top level (a block, a columns
 *   table) goes onto the page before it, or onto a new first page when there
 *   is none, so nothing is ever lost.
 * - There is always at least one page.
 *
 * Idempotent, so the editor and the service can both run it on every change.
 */
export function normaliseCanvas(canvas: DocumentCanvas): DocumentCanvas {
	const paper = toPaper(canvas.paper);
	const pages: MailContainer[] = [];
	for (const node of canvas.layout.children) {
		if (node.kind === "container") {
			pages.push(isPage(node, paper) ? node : toPageShape(node, paper));
			continue;
		}
		let last = pages[pages.length - 1];
		if (!last) {
			last = newPage(paper, "Page 1");
			pages.push(last);
		}
		pages[pages.length - 1] = { ...last, children: [...last.children, node as MailNode] };
	}
	if (pages.length === 0) pages.push(newPage(paper, "Page 1"));

	const { width } = paperPx(paper);
	const layout: MailLayout = {
		...canvas.layout,
		version: 2,
		width,
		widthMode: "fixed",
		minHeight: 0,
		fill: null,
		breakpoints: [],
		children: pages,
	};
	return { version: 1, paper, layout };
}

function toPageShape(node: MailContainer, paper: DocumentPaper): MailContainer {
	return { ...node, tag: "section", hidden: false, alignSelf: "auto", grow: 0, box: pageBox(paper, node.box) };
}

function isPage(node: MailContainer, paper: DocumentPaper): boolean {
	const { width, height } = paperPx(paper);
	const box = node.box;
	return (
		node.tag === "section" &&
		!node.hidden &&
		node.alignSelf === "auto" &&
		node.grow === 0 &&
		box.width === width &&
		box.minHeight === height &&
		box.clip &&
		box.margin.top === 0 &&
		box.margin.right === 0 &&
		box.margin.bottom === PAGE_GAP &&
		box.margin.left === 0 &&
		box.borderRadius === 0 &&
		box.corners === null
	);
}

/** The pages of a canvas: its top-level containers. */
export function pagesOf(layout: MailLayout): MailContainer[] {
	return layout.children.filter((node): node is MailContainer => node.kind === "container");
}

/** Changes the paper, resizing every page to it. */
export function withPaper(canvas: DocumentCanvas, paper: DocumentPaper): DocumentCanvas {
	return normaliseCanvas({ ...canvas, paper });
}

/** The key an asset id is written as in `{{asset.<key>}}`: its id without the hyphens, which the template syntax does not allow. */
export function assetKey(assetId: string): string {
	return assetId.replace(/-/g, "");
}

export function assetToken(assetId: string): string {
	return `{{asset.${assetKey(assetId)}}}`;
}

/** The asset key an image source names, or null when it names none. */
export function assetKeyOf(src: string): string | null {
	const match = /^\{\{\s*asset\.([a-f0-9]+)\s*\}\}$/i.exec(src.trim());
	return match ? match[1]!.toLowerCase() : null;
}

/** Where the window draws a template's picture from. Served by id, never by path. */
export function assetUrl(assetId: string): string {
	return `app://asset/template/${assetId}`;
}
