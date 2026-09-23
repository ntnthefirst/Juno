/**
 * Turns a structured page model into the HTML fragment the existing print
 * pipeline already knows how to print.
 *
 * Pure and Electron-free on purpose: the visual page editor and its tests run
 * this function directly, and `printToPDF` never sees the model, only the
 * string this produces. `documentShell` (document-style.ts) wraps that string
 * in `<html>`/`<head>`/`<body>` and supplies the shared `@page` margin, which
 * is why the very first thing the compiled output does is cancel it: the page
 * model owns its own geometry as padding on `.juno-page`, and a margin applied
 * twice would push every page a second time.
 */
import { randomUUID } from "node:crypto";
import type {
	DocumentLayout,
	LayoutAlign,
	LayoutBlock,
	LayoutBox,
	LayoutPage,
	Mm,
	PageMargin,
} from "../../shared/types";
import { escapeHtml, placeholdersIn } from "./template-render";

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** Matches DOCUMENT_CSS's `@page` margin, so a layout starts looking like the
 * page it is going to print onto. */
export const DEFAULT_MARGIN: PageMargin = { top: 24, right: 20, bottom: 22, left: 20 };

export function emptyPage(): LayoutPage {
	return { id: randomUUID(), blocks: [], boxes: [] };
}

export function emptyLayout(): DocumentLayout {
	return {
		version: 1,
		pageSize: "A4",
		margin: { ...DEFAULT_MARGIN },
		pages: [emptyPage()],
	};
}

export function contentWidthMm(margin: PageMargin): number {
	return A4_WIDTH_MM - margin.left - margin.right;
}

export function contentHeightMm(margin: PageMargin): number {
	return A4_HEIGHT_MM - margin.top - margin.bottom;
}

/* ------------------------------------------------------------------- parse */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStr(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function toBool(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function toId(value: unknown): string {
	return typeof value === "string" && value.length > 0 ? value : randomUUID();
}

/** Every millimetre value in a layout is clamped to this range on the way in,
 * because it came out of a database column a future version may have written
 * differently. */
function clampMm(value: unknown, fallback: Mm): Mm {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1000) : fallback;
}

/** A width can never exceed the page it has to fit on. */
function clampWidthMm(value: unknown, fallback: Mm): Mm {
	return Math.min(clampMm(value, fallback), A4_WIDTH_MM);
}

function toAlign(value: unknown): LayoutAlign {
	return value === "left" || value === "center" || value === "right" || value === "justify" ? value : "left";
}

function parseBlock(raw: unknown): LayoutBlock | null {
	if (!isRecord(raw)) return null;
	const id = toId(raw.id);

	switch (raw.kind) {
		case "heading": {
			const level = raw.level === 1 || raw.level === 2 || raw.level === 3 ? raw.level : 1;
			return { id, kind: "heading", level, text: toStr(raw.text), align: toAlign(raw.align) };
		}
		case "paragraph":
			return { id, kind: "paragraph", html: toStr(raw.html), align: toAlign(raw.align) };
		case "list":
			return {
				id,
				kind: "list",
				ordered: toBool(raw.ordered),
				items: Array.isArray(raw.items) ? raw.items.filter((item): item is string => typeof item === "string") : [],
			};
		case "image":
			return {
				id,
				kind: "image",
				src: toStr(raw.src),
				alt: toStr(raw.alt),
				widthMm: clampWidthMm(raw.widthMm, 40),
				align: toAlign(raw.align),
			};
		case "spacer":
			return { id, kind: "spacer", heightMm: clampMm(raw.heightMm, 10) };
		case "divider":
			return { id, kind: "divider" };
		case "table": {
			const columns = Array.isArray(raw.columns)
				? raw.columns.filter(isRecord).map((col) => ({
						header: toStr(col.header),
						widthPct: typeof col.widthPct === "number" && Number.isFinite(col.widthPct) ? col.widthPct : 0,
					}))
				: [];
			const rows = Array.isArray(raw.rows)
				? raw.rows.map((row) => (Array.isArray(row) ? row.map((cell) => toStr(cell)) : []))
				: [];
			return { id, kind: "table", columns, rows, headerRow: toBool(raw.headerRow) };
		}
		case "signature":
			return { id, kind: "signature", label: toStr(raw.label), widthMm: clampWidthMm(raw.widthMm, 70) };
		default:
			// An unrecognised kind is a future version's block. Drop it rather than
			// guessing at a shape, and keep everything else on the page.
			return null;
	}
}

function parseBox(raw: unknown): LayoutBox | null {
	if (!isRecord(raw)) return null;
	const { xMm, yMm, widthMm } = raw;
	if (typeof xMm !== "number" || !Number.isFinite(xMm)) return null;
	if (typeof yMm !== "number" || !Number.isFinite(yMm)) return null;
	if (typeof widthMm !== "number" || !Number.isFinite(widthMm)) return null;

	const block = parseBlock(raw.block);
	if (!block) return null;

	return {
		id: toId(raw.id),
		xMm: Math.min(Math.max(xMm, 0), 1000),
		yMm: Math.min(Math.max(yMm, 0), 1000),
		widthMm: Math.min(Math.max(widthMm, 0), A4_WIDTH_MM),
		block,
	};
}

function parsePage(raw: unknown): LayoutPage | null {
	if (!isRecord(raw)) return null;
	const blocks = Array.isArray(raw.blocks)
		? raw.blocks.map(parseBlock).filter((block): block is LayoutBlock => block !== null)
		: [];
	const boxes = Array.isArray(raw.boxes)
		? raw.boxes.map(parseBox).filter((box): box is LayoutBox => box !== null)
		: [];
	return { id: toId(raw.id), blocks, boxes };
}

/**
 * Defensive because this comes straight out of a database column. Never
 * throws: anything that does not look like a version-1 layout is null, and
 * the caller falls back to plain HTML the way it already does for a template
 * with no layout at all.
 */
export function parseLayout(json: string | null): DocumentLayout | null {
	if (!json) return null;

	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}

	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;

	const rawMargin = isRecord(raw.margin) ? raw.margin : {};
	const margin: PageMargin = {
		top: clampMm(rawMargin.top, DEFAULT_MARGIN.top),
		right: clampMm(rawMargin.right, DEFAULT_MARGIN.right),
		bottom: clampMm(rawMargin.bottom, DEFAULT_MARGIN.bottom),
		left: clampMm(rawMargin.left, DEFAULT_MARGIN.left),
	};

	const pages = Array.isArray(raw.pages)
		? raw.pages.map(parsePage).filter((page): page is LayoutPage => page !== null)
		: [];

	return {
		version: 1,
		pageSize: "A4",
		margin,
		// An editor cannot show nothing, so a layout that lost every page still
		// opens to one empty one.
		pages: pages.length > 0 ? pages : [emptyPage()],
	};
}

export function serialiseLayout(layout: DocumentLayout): string {
	return JSON.stringify(layout);
}

/* ---------------------------------------------------------------- sanitise */

const ALLOWED_INLINE_TAGS = new Set(["strong", "em", "u", "s", "a"]);
const INLINE_TAG_RE = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;

function extractHref(attrs: string): string | null {
	const match = attrs.match(/\bhref\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bhref\s*=\s*'([^']*)'/i);
	if (!match) return null;
	const raw = (match[1] ?? "").trim();
	return /^(https?:|mailto:)/i.test(raw) ? raw : null;
}

/**
 * The only inline markup a paragraph or a table cell is allowed to carry:
 * `strong`, `em`, `u`, `s`, `br` and `a href="..."`. Everything else, tag or
 * attribute, is escaped down to visible text rather than dropped silently, so
 * a stray angle bracket in a client's name cannot be mistaken for markup that
 * survived on purpose. `{{ placeholder }}` tokens contain none of the
 * characters this looks for, so they pass through untouched for the existing
 * placeholder renderer to fill in afterwards.
 */
export function sanitiseInline(html: string): string {
	let out = "";
	let cursor = 0;

	for (const match of html.matchAll(INLINE_TAG_RE)) {
		const start = match.index ?? 0;
		out += escapeHtml(html.slice(cursor, start));
		cursor = start + match[0].length;

		const closing = Boolean(match[1]);
		const name = match[2]!.toLowerCase();
		const attrs = match[3] ?? "";

		if (name === "br") {
			// A void element. The closing form is nonsense and dropped rather than
			// echoed, an opening or self-closing form becomes a plain <br>.
			if (!closing) out += "<br>";
			continue;
		}

		if (!ALLOWED_INLINE_TAGS.has(name)) {
			out += escapeHtml(match[0]);
			continue;
		}

		if (closing) {
			out += `</${name}>`;
			continue;
		}

		if (name === "a") {
			const href = extractHref(attrs);
			out += href ? `<a href="${escapeHtml(href)}">` : "<a>";
			continue;
		}

		// strong, em, u, s: every attribute is dropped, including any on* handler
		// and any style, because none of the allowed tags needs one.
		out += `<${name}>`;
	}

	out += escapeHtml(html.slice(cursor));
	return out;
}

/**
 * Documents are printed locally, so an https image, an embedded data image and
 * a local file are all legitimate. Anything else (http, javascript:, an
 * unrecognised scheme) is not a broken image worth showing, it is refused
 * input, so it renders as nothing.
 */
function isAllowedImageSrc(src: string): boolean {
	if (/^https:\/\//i.test(src)) return true;
	if (/^data:image\//i.test(src)) return true;
	if (/^file:\/\//i.test(src)) return true;
	if (/^[a-zA-Z]:[\\/]/.test(src)) return true; // C:\... or C:/...
	if (src.startsWith("/")) return true; // a POSIX absolute path
	return false;
}

/* --------------------------------------------------------------- compile */

/**
 * `@page { margin: 0 }` cancels the shell's own margin so it is never applied
 * twice, and `.juno-page` owns the geometry instead: full A4 size, the margin
 * moved onto padding, and a forced break after every page but the last. Boxes
 * paint over the flow because they come after it in source order.
 */
const LAYOUT_CSS = `
@page {
	size: A4;
	margin: 0;
}
.juno-page {
	position: relative;
	box-sizing: border-box;
	width: ${A4_WIDTH_MM}mm;
	height: ${A4_HEIGHT_MM}mm;
	overflow: hidden;
}
.juno-page:not(:last-child) {
	break-after: page;
	page-break-after: always;
}
.juno-box {
	position: absolute;
}
.juno-signature {
	box-sizing: border-box;
	height: 22mm;
	padding-top: 2mm;
	border-top: 0.3mm solid #111111;
	font-size: 9.5pt;
}
.juno-signature-label {
	color: #555555;
}
table {
	width: 100%;
	border-collapse: collapse;
}
th, td {
	padding: 1mm 2mm;
	border: 0.2mm solid #cccccc;
	text-align: left;
	vertical-align: top;
}
thead th {
	font-weight: 600;
}
hr {
	margin: 4mm 0;
	border: none;
	border-top: 0.2mm solid #cccccc;
}
`;

function renderHeading(block: Extract<LayoutBlock, { kind: "heading" }>): string {
	const tag = `h${block.level}`;
	return `<${tag} style="text-align: ${block.align}">${escapeHtml(block.text)}</${tag}>`;
}

function renderParagraph(block: Extract<LayoutBlock, { kind: "paragraph" }>): string {
	return `<p style="text-align: ${block.align}">${sanitiseInline(block.html)}</p>`;
}

function renderList(block: Extract<LayoutBlock, { kind: "list" }>): string {
	const tag = block.ordered ? "ol" : "ul";
	const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
	return `<${tag}>${items}</${tag}>`;
}

function renderImage(block: Extract<LayoutBlock, { kind: "image" }>): string {
	if (!isAllowedImageSrc(block.src)) return "";
	return (
		`<div style="text-align: ${block.align}">` +
		`<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" style="width: ${block.widthMm}mm">` +
		`</div>`
	);
}

function renderSpacer(block: Extract<LayoutBlock, { kind: "spacer" }>): string {
	return `<div style="height: ${block.heightMm}mm"></div>`;
}

function renderTable(block: Extract<LayoutBlock, { kind: "table" }>): string {
	const colgroup = block.columns.map((col) => `<col style="width: ${col.widthPct}%">`).join("");
	const headerCells = block.columns.map((col) => `<th>${escapeHtml(col.header)}</th>`).join("");
	const thead = block.headerRow ? `<thead><tr>${headerCells}</tr></thead>` : "";
	const bodyRows = block.rows
		.map((row) => `<tr>${row.map((cell) => `<td>${sanitiseInline(cell)}</td>`).join("")}</tr>`)
		.join("");
	return `<table><colgroup>${colgroup}</colgroup>${thead}<tbody>${bodyRows}</tbody></table>`;
}

function renderSignature(block: Extract<LayoutBlock, { kind: "signature" }>): string {
	return (
		`<div class="juno-signature" data-signature-field style="width: ${block.widthMm}mm">` +
		`<div class="juno-signature-label">${escapeHtml(block.label)}</div>` +
		`</div>`
	);
}

function renderBlock(block: LayoutBlock): string {
	switch (block.kind) {
		case "heading":
			return renderHeading(block);
		case "paragraph":
			return renderParagraph(block);
		case "list":
			return renderList(block);
		case "image":
			return renderImage(block);
		case "spacer":
			return renderSpacer(block);
		case "divider":
			return "<hr>";
		case "table":
			return renderTable(block);
		case "signature":
			return renderSignature(block);
	}
}

function renderPage(page: LayoutPage, margin: PageMargin): string {
	const flow = page.blocks.map(renderBlock).join("");
	const boxes = page.boxes
		.map(
			(box) =>
				`<div class="juno-box" style="left: ${box.xMm}mm; top: ${box.yMm}mm; width: ${box.widthMm}mm">` +
				renderBlock(box.block) +
				`</div>`,
		)
		.join("");
	const padding = `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`;
	return `<section class="juno-page" style="padding: ${padding}"><div class="juno-flow">${flow}</div>${boxes}</section>`;
}

/**
 * The HTML fragment `documentShell` wraps: no `<html>`, `<head>` or `<body>`,
 * one `<style>` block first, then one `<section class="juno-page">` per page
 * in order. Pure and deterministic, so the same layout always compiles to the
 * same string.
 */
export function compileLayout(layout: DocumentLayout): string {
	const pages = layout.pages.map((page) => renderPage(page, layout.margin)).join("");
	return `<style>${LAYOUT_CSS}</style>${pages}`;
}

/**
 * Every `{{ path }}` referenced anywhere in the layout, sorted and unique.
 * Reuses the compiled output rather than walking the model a second time, so
 * a new block kind only has to teach `compileLayout` where its text goes.
 */
export function layoutPlaceholders(layout: DocumentLayout): string[] {
	return placeholdersIn(compileLayout(layout));
}
