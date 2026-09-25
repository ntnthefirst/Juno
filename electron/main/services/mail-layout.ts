/**
 * Turns the mail template canvas into the HTML a message body is made of, and
 * reads that HTML back into a canvas.
 *
 * Pure and Electron-free on purpose: the editor, the service and the tests all
 * call these directly, and nothing below them ever learns that a canvas
 * exists. `mailShell` (mail-html.ts) wraps whatever `compileLayout` returns in
 * the 600 pixel house table, so this function emits the contents of that
 * table and never a document.
 *
 * Two rules shape the whole model:
 *
 * 1. **Nothing is positioned.** A block is placed by the rules of the section
 *    holding it or it is not placed at all. There is no `position`, no `top`,
 *    no `float`, and `sanitiseDeclarations` strips them out of hand-written
 *    CSS as well, so the escape hatch cannot reintroduce what the model
 *    refuses.
 * 2. **The layout is the source and the HTML is output.** They cannot disagree,
 *    because one write produces both.
 *
 * The compiled output carries `data-juno-*` attributes on every section and
 * block. That is what makes the code view editable rather than read-only:
 * `layoutFromHtml` reads those markers back, and anything it cannot place
 * lands in a raw `html` block instead of being dropped. Nothing a person
 * types is ever silently lost.
 *
 * ## Outlook
 *
 * This compiles to literal `display:flex` and `display:grid`. Outlook on
 * Windows renders with Word's engine, which supports neither, and will stack
 * every section into a single column with the gaps and the alignment gone.
 * That is a deliberate choice rather than an oversight, and the editor says so
 * where the choice is made rather than leaving it to be found by a recipient.
 */
import { randomUUID } from "node:crypto";
import type {
	MailAlign,
	MailBlock,
	MailBoxStyle,
	MailColor,
	MailDirection,
	MailJustify,
	MailLayout,
	MailSection,
	MailSectionLayout,
	MailSpacing,
	MailTextAlign,
	MailTextStyle,
	MailWeight,
	TemplateInput,
} from "../../shared/types";
import { escapeHtml } from "./template-render";

/** What every mail client agrees a message body is. Also mailShell's table. */
export const DEFAULT_WIDTH = 600;
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 20000;

/* ----------------------------------------------------------------- defaults */

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
	return { id: randomUUID(), name, layout: stackLayout(), box: emptyBox(), blocks: [] };
}

export function emptyLayout(): MailLayout {
	return {
		version: 1,
		width: DEFAULT_WIDTH,
		minHeight: 320,
		background: null,
		customCss: null,
		sections: [emptySection("Body")],
	};
}

/** A new block of each kind, with values that render as something visible. */
export function newBlock(kind: MailBlock["kind"]): MailBlock {
	const id = randomUUID();
	switch (kind) {
		case "heading":
			return { id, kind, level: 2, content: "Titel", text: { ...defaultText(), weight: "semibold" }, box: emptyBox(), grow: 0 };
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

/* -------------------------------------------------------------------- parse */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStr(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function toId(value: unknown): string {
	return typeof value === "string" && value.length > 0 ? value : randomUUID();
}

function toNum(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(value, min), max);
}

function toNullableNum(value: unknown, min: number, max: number): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.min(Math.max(value, min), max);
}

/**
 * A colour is a hex string and nothing else.
 *
 * Refusing anything that is not `#rgb` or `#rrggbb` is what keeps a colour
 * field from becoming a second way to write arbitrary CSS: `red;position:fixed`
 * is a perfectly good-looking string until it is concatenated into a style
 * attribute.
 */
export function toColor(value: unknown): MailColor | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : null;
}

function colorOr(value: unknown, fallback: MailColor): MailColor {
	return toColor(value) ?? fallback;
}

function toAlignText(value: unknown): MailTextAlign {
	return value === "center" || value === "right" || value === "justify" ? value : "left";
}

function toAlign(value: unknown): MailAlign {
	return value === "start" || value === "center" || value === "end" ? value : "stretch";
}

function toJustify(value: unknown): MailJustify {
	return value === "center" || value === "end" || value === "between" || value === "around" ? value : "start";
}

function toDirection(value: unknown): MailDirection {
	return value === "row" ? "row" : "column";
}

function toWeight(value: unknown): MailWeight {
	return value === "medium" || value === "semibold" || value === "bold" ? value : "normal";
}

function parseSpacing(raw: unknown): MailSpacing {
	if (!isRecord(raw)) return noSpacing();
	return {
		top: toNum(raw.top, 0, 0, 200),
		right: toNum(raw.right, 0, 0, 200),
		bottom: toNum(raw.bottom, 0, 0, 200),
		left: toNum(raw.left, 0, 0, 200),
	};
}

function parseBox(raw: unknown): MailBoxStyle {
	if (!isRecord(raw)) return emptyBox();
	return {
		background: toColor(raw.background),
		padding: parseSpacing(raw.padding),
		borderWidth: toNum(raw.borderWidth, 0, 0, 40),
		borderColor: toColor(raw.borderColor),
		borderRadius: toNum(raw.borderRadius, 0, 0, 80),
		customCss: sanitiseDeclarations(toStr(raw.customCss)) || null,
	};
}

function parseTextStyle(raw: unknown): MailTextStyle {
	if (!isRecord(raw)) return defaultText();
	return {
		color: toColor(raw.color),
		fontSize: toNullableNum(raw.fontSize, 8, 96),
		lineHeight: toNullableNum(raw.lineHeight, 0.8, 4),
		weight: toWeight(raw.weight),
		align: toAlignText(raw.align),
	};
}

function parseSectionLayout(raw: unknown): MailSectionLayout {
	if (!isRecord(raw)) return stackLayout();
	if (raw.kind === "grid") {
		return {
			kind: "grid",
			columns: toNum(raw.columns, 2, 1, 6),
			gap: toNum(raw.gap, 12, 0, 120),
			align: toAlign(raw.align),
		};
	}
	return {
		kind: "flex",
		direction: toDirection(raw.direction),
		justify: toJustify(raw.justify),
		align: toAlign(raw.align),
		gap: toNum(raw.gap, 12, 0, 120),
		wrap: raw.wrap === true,
	};
}

function parseBlock(raw: unknown): MailBlock | null {
	if (!isRecord(raw)) return null;
	const id = toId(raw.id);
	const grow = toNum(raw.grow, 0, 0, 12);
	const box = parseBox(raw.box);

	switch (raw.kind) {
		case "heading": {
			const level = raw.level === 1 || raw.level === 3 ? raw.level : 2;
			return { id, kind: "heading", level, content: toStr(raw.content), text: parseTextStyle(raw.text), box, grow };
		}
		case "button":
			return {
				id,
				kind: "button",
				label: toStr(raw.label),
				href: safeHref(toStr(raw.href)) ?? "",
				background: colorOr(raw.background, "#4a3fa0"),
				color: colorOr(raw.color, "#ffffff"),
				radius: toNum(raw.radius, 4, 0, 80),
				box,
				grow,
			};
		case "image":
			return {
				id,
				kind: "image",
				src: safeImageSrc(toStr(raw.src)) ?? "",
				alt: toStr(raw.alt),
				width: toNullableNum(raw.width, 8, MAX_WIDTH),
				align: toAlignText(raw.align),
				box,
				grow,
			};
		case "divider":
			return { id, kind: "divider", color: colorOr(raw.color, "#e3e2ec"), thickness: toNum(raw.thickness, 1, 1, 20), box, grow };
		case "spacer":
			return { id, kind: "spacer", height: toNum(raw.height, 16, 1, 400), grow };
		case "field":
			return { id, kind: "field", inputKey: toStr(raw.inputKey).trim(), text: parseTextStyle(raw.text), box, grow };
		case "html":
			return { id, kind: "html", html: sanitiseFragment(toStr(raw.html)), box, grow };
		case "text":
			return { id, kind: "text", html: sanitiseFragment(toStr(raw.html)), text: parseTextStyle(raw.text), box, grow };
		default:
			return null;
	}
}

function parseSection(raw: unknown): MailSection | null {
	if (!isRecord(raw)) return null;
	const blocks = Array.isArray(raw.blocks)
		? raw.blocks.map(parseBlock).filter((block): block is MailBlock => block !== null)
		: [];
	return {
		id: toId(raw.id),
		name: toStr(raw.name, "Section"),
		layout: parseSectionLayout(raw.layout),
		box: parseBox(raw.box),
		blocks,
	};
}

/**
 * Reads a stored canvas back. Never throws: a row whose `layout_json` cannot
 * be understood behaves as an HTML-only template, which is the state every
 * template written before the canvas is already in, rather than failing to
 * load at all.
 */
export function parseLayout(json: string | null | undefined): MailLayout | null {
	if (!json) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	return normaliseLayout(raw);
}

/** The same checks, for a layout that arrived over IPC or from an agent. */
export function normaliseLayout(raw: unknown): MailLayout | null {
	if (!isRecord(raw)) return null;
	const sections = Array.isArray(raw.sections)
		? raw.sections.map(parseSection).filter((section): section is MailSection => section !== null)
		: [];
	return {
		version: 1,
		width: toNum(raw.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
		minHeight: toNum(raw.minHeight, 320, 0, MAX_HEIGHT),
		background: toColor(raw.background),
		customCss: sanitiseDeclarations(toStr(raw.customCss)) || null,
		sections: sections.length > 0 ? sections : [emptySection("Body")],
	};
}

export function serialiseLayout(layout: MailLayout | null): string | null {
	return layout ? JSON.stringify(layout) : null;
}

/* ----------------------------------------------------------------- sanitise */

/**
 * The properties a hand-written declaration block may not set.
 *
 * Positioning is the whole point of the list: the model has no absolute
 * placement, and custom CSS is the one place an author could put it back.
 * `expression`, `behavior` and `@import` are the old Internet Explorer routes
 * to running code from a stylesheet, and a template body is rendered in a
 * preview frame in this app before it is ever rendered in anybody's client.
 */
const BANNED_PROPERTIES = new Set([
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"float",
	"clear",
	"z-index",
	"transform",
	"behavior",
	"-moz-binding",
]);

/**
 * Cleans a hand-typed declaration block down to `prop:value` pairs.
 *
 * Braces come out, so a field meant for declarations cannot become a
 * stylesheet with its own selectors, and a declaration naming a banned
 * property is dropped rather than escaped, because there is no reading of
 * `position:absolute` that is worth keeping.
 */
export function sanitiseDeclarations(css: string): string {
	if (!css.trim()) return "";
	const flattened = css.replace(/[{}]/g, " ").replace(/@\w+[^;]*;?/g, " ");
	const kept: string[] = [];
	for (const part of flattened.split(";")) {
		const colon = part.indexOf(":");
		if (colon < 0) continue;
		const property = part.slice(0, colon).trim().toLowerCase();
		const value = part.slice(colon + 1).trim();
		if (!property || !value) continue;
		// A real property is one identifier. Anything with a space in it is what
		// is left of a selector once the braces came out, so the whole
		// declaration is refused rather than half-salvaged: a field that takes
		// declarations takes declarations, and guessing which part of a rule was
		// meant is how something nobody wrote ends up in the message.
		if (!/^-?[a-z][a-z0-9-]*$/.test(property)) continue;
		if (BANNED_PROPERTIES.has(property)) continue;
		if (/expression\s*\(|javascript:|url\s*\(\s*['"]?\s*(javascript|data):/i.test(value)) continue;
		if (/["<>]/.test(value)) continue;
		kept.push(`${property}:${value}`);
	}
	return kept.join(";");
}

const ALLOWED_INLINE_TAGS = new Set(["strong", "b", "em", "i", "u", "s", "a", "span", "p", "br"]);
const TAG_RE = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;

/** An `https:` or `mailto:` target, or nothing. Never `http:`, which leaks the
 * recipient's address to anyone on the path, and never `javascript:`. */
export function safeHref(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	// A placeholder is resolved long after this runs, so it cannot be checked
	// here and is allowed through as the author wrote it.
	if (/^\{\{[^{}]+\}\}$/.test(trimmed)) return trimmed;
	return /^(https:|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** An image address. `https:` only, for the reason in docs/editors.md. */
export function safeImageSrc(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (/^\{\{[^{}]+\}\}$/.test(trimmed)) return trimmed;
	return /^https:/i.test(trimmed) ? trimmed : null;
}

function attribute(attrs: string, name: string): string | null {
	const match =
		attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ??
		attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
	return match ? (match[1] ?? "").trim() : null;
}

/**
 * The markup a text block or a raw block is allowed to carry.
 *
 * Everything outside the allowed set is escaped down to visible text rather
 * than dropped, so a stray angle bracket in somebody's business name cannot be
 * mistaken for markup that survived on purpose. `{{ placeholder }}` tokens
 * contain none of the characters this looks for and pass through untouched.
 */
export function sanitiseFragment(html: string): string {
	let out = "";
	let cursor = 0;

	for (const match of html.matchAll(TAG_RE)) {
		const start = match.index ?? 0;
		out += escapeHtml(html.slice(cursor, start));
		cursor = start + match[0].length;

		const closing = Boolean(match[1]);
		const name = (match[2] ?? "").toLowerCase();
		const attrs = match[3] ?? "";

		if (!ALLOWED_INLINE_TAGS.has(name)) {
			out += escapeHtml(match[0]);
			continue;
		}
		if (name === "br") {
			if (!closing) out += "<br>";
			continue;
		}
		if (closing) {
			out += `</${name}>`;
			continue;
		}
		if (name === "a") {
			const href = safeHref(attribute(attrs, "href") ?? "");
			// A link with no usable target keeps its words and loses its anchor,
			// rather than shipping an <a> that goes nowhere.
			out += href ? `<a href="${escapeHtml(href)}">` : "";
			continue;
		}
		if (name === "span" || name === "p") {
			const style = sanitiseDeclarations(attribute(attrs, "style") ?? "");
			out += style ? `<${name} style="${escapeHtml(style)}">` : `<${name}>`;
			continue;
		}
		out += `<${name}>`;
	}

	out += escapeHtml(html.slice(cursor));
	return out;
}

/* ------------------------------------------------------------------ compile */

function styleString(pairs: (string | null)[]): string {
	const kept = pairs.filter((pair): pair is string => Boolean(pair));
	return kept.length > 0 ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

function paddingDeclaration(padding: MailSpacing): string | null {
	const { top, right, bottom, left } = padding;
	if (!top && !right && !bottom && !left) return null;
	return `padding:${top}px ${right}px ${bottom}px ${left}px`;
}

function boxDeclarations(box: MailBoxStyle): (string | null)[] {
	return [
		box.background ? `background:${box.background}` : null,
		paddingDeclaration(box.padding),
		box.borderWidth > 0 ? `border:${box.borderWidth}px solid ${box.borderColor ?? "#e3e2ec"}` : null,
		box.borderRadius > 0 ? `border-radius:${box.borderRadius}px` : null,
		// Last, so a hand-written declaration wins over the controls above it.
		box.customCss,
	];
}

function textDeclarations(text: MailTextStyle): (string | null)[] {
	const weight =
		text.weight === "bold" ? "700" : text.weight === "semibold" ? "600" : text.weight === "medium" ? "500" : null;
	return [
		text.color ? `color:${text.color}` : null,
		text.fontSize ? `font-size:${text.fontSize}px` : null,
		text.lineHeight ? `line-height:${text.lineHeight}` : null,
		weight ? `font-weight:${weight}` : null,
		text.align !== "left" ? `text-align:${text.align}` : null,
	];
}

const JUSTIFY_CSS: Record<MailJustify, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	between: "space-between",
	around: "space-around",
};

const ALIGN_CSS: Record<MailAlign, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
};

function layoutDeclarations(layout: MailSectionLayout): string[] {
	if (layout.kind === "grid") {
		return [
			"display:grid",
			`grid-template-columns:repeat(${layout.columns},1fr)`,
			`gap:${layout.gap}px`,
			`align-items:${ALIGN_CSS[layout.align]}`,
		];
	}
	return [
		"display:flex",
		`flex-direction:${layout.direction}`,
		`justify-content:${JUSTIFY_CSS[layout.justify]}`,
		`align-items:${ALIGN_CSS[layout.align]}`,
		`gap:${layout.gap}px`,
		layout.wrap ? "flex-wrap:wrap" : "flex-wrap:nowrap",
	];
}

/**
 * The placeholder a declared input is written as. An input keyed `scope` is
 * `{{document.scope}}`, which is the same rule the typed placeholders follow
 * (template-inputs.ts), so a field block and a hand-typed token resolve
 * through one code path.
 */
export function fieldPlaceholder(inputKey: string): string {
	return `{{document.${inputKey}}}`;
}

function compileBlock(block: MailBlock, inputs: TemplateInput[]): string {
	const marker = ` data-juno-block="${block.kind}" data-juno-id="${escapeHtml(block.id)}"`;
	const grow = block.grow > 0 ? `flex:${block.grow} 1 0%` : null;

	switch (block.kind) {
		case "heading": {
			const tag = `h${block.level}`;
			const style = styleString([
				"margin:0",
				...textDeclarations(block.text),
				...boxDeclarations(block.box),
				grow,
			]);
			return `<${tag}${marker}${style}>${escapeHtml(block.content)}</${tag}>`;
		}
		case "text": {
			const style = styleString(["margin:0", ...textDeclarations(block.text), ...boxDeclarations(block.box), grow]);
			return `<div${marker}${style}>${sanitiseFragment(block.html)}</div>`;
		}
		case "button": {
			const href = safeHref(block.href);
			const style = styleString([
				"display:inline-block",
				"text-decoration:none",
				`background:${block.background}`,
				`color:${block.color}`,
				`border-radius:${block.radius}px`,
				paddingDeclaration(block.box.padding) ?? "padding:10px 18px",
				block.box.customCss,
				grow,
			]);
			// Without a target it is a label, not a link. Emitting an <a> with no
			// href would give the recipient something that looks pressable and is
			// not, which is worse than showing the words.
			return href
				? `<a${marker} href="${escapeHtml(href)}"${style}>${escapeHtml(block.label)}</a>`
				: `<span${marker}${style}>${escapeHtml(block.label)}</span>`;
		}
		case "image": {
			const src = safeImageSrc(block.src);
			if (!src) {
				return `<span${marker} style="color:#5d5e70;font-size:12px;">${escapeHtml(block.alt || "Geen afbeelding")}</span>`;
			}
			const style = styleString([
				"display:block",
				"max-width:100%",
				block.width ? `width:${block.width}px` : null,
				"height:auto",
				block.align === "center" ? "margin:0 auto" : block.align === "right" ? "margin-left:auto" : null,
				...boxDeclarations(block.box),
				grow,
			]);
			return `<img${marker} src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}"${style}>`;
		}
		case "divider": {
			const style = styleString([
				"border:0",
				`border-top:${block.thickness}px solid ${block.color}`,
				"width:100%",
				paddingDeclaration(block.box.padding),
				block.box.customCss,
				grow,
			]);
			return `<hr${marker}${style}>`;
		}
		case "spacer": {
			const style = styleString([`height:${block.height}px`, "line-height:0", "font-size:0", grow]);
			return `<div${marker}${style}>&nbsp;</div>`;
		}
		case "field": {
			const declared = inputs.find((input) => input.key === block.inputKey);
			const token = block.inputKey ? fieldPlaceholder(block.inputKey) : "";
			const style = styleString([...textDeclarations(block.text), ...boxDeclarations(block.box), grow]);
			if (!token) {
				return `<span${marker} style="color:#5d5e70;font-size:12px;">${escapeHtml("Geen invoerveld gekozen")}</span>`;
			}
			// An image input is a picture, not its address. Anything else is text,
			// and the renderer fills the token wherever it lands.
			if (declared?.kind === "image") {
				return `<img${marker} data-juno-field="${escapeHtml(block.inputKey)}" src="${token}" alt="${escapeHtml(declared.label || block.inputKey)}"${styleString(["display:block", "max-width:100%", "height:auto", ...boxDeclarations(block.box), grow])}>`;
			}
			if (declared?.kind === "url") {
				return `<a${marker} data-juno-field="${escapeHtml(block.inputKey)}" href="${token}"${style}>${escapeHtml(declared.label || block.inputKey)}</a>`;
			}
			return `<span${marker} data-juno-field="${escapeHtml(block.inputKey)}"${style}>${token}</span>`;
		}
		case "html": {
			const style = styleString([...boxDeclarations(block.box), grow]);
			return `<div${marker}${style}>${sanitiseFragment(block.html)}</div>`;
		}
	}
}

function compileSection(section: MailSection, inputs: TemplateInput[]): string {
	const style = styleString([...layoutDeclarations(section.layout), ...boxDeclarations(section.box)]);
	const children = section.blocks.map((block) => compileBlock(block, inputs)).join("");
	return `<div data-juno-section="${escapeHtml(section.name)}" data-juno-id="${escapeHtml(section.id)}"${style}>${children}</div>`;
}

/**
 * The body fragment for a canvas. `mailShell` wraps this, so it deliberately
 * emits no `<html>`, no `<head>` and no width of its own beyond the frame the
 * author set.
 */
export function compileLayout(layout: MailLayout, inputs: TemplateInput[] = []): string {
	const style = styleString([
		`max-width:${layout.width}px`,
		layout.minHeight > 0 ? `min-height:${layout.minHeight}px` : null,
		layout.background ? `background:${layout.background}` : null,
		layout.customCss,
	]);
	const sections = layout.sections.map((section) => compileSection(section, inputs)).join("");
	return `<div data-juno-canvas="1"${style}>${sections}</div>`;
}

/* --------------------------------------------------------------- read back */

const VOID_TAGS = new Set(["img", "hr", "br", "input", "meta", "link", "source", "area", "col"]);

type Node =
	| { type: "text"; raw: string }
	| { type: "element"; name: string; attrs: string; inner: string; raw: string };

/**
 * Splits a fragment into its top-level nodes, keeping each element's own
 * markup intact.
 *
 * A regular expression cannot do this, because the whole job is matching a
 * closing tag to the right opening one through however many nested divs a
 * section turned out to have. It is a depth counter rather than a parser: it
 * understands nesting and nothing else, which is all reading back our own
 * compiled output asks for. Markup it cannot make sense of is handed back as
 * text and ends up in a raw block, never dropped.
 */
function splitTopLevel(html: string): Node[] {
	const nodes: Node[] = [];
	let cursor = 0;

	while (cursor < html.length) {
		const open = html.indexOf("<", cursor);
		if (open < 0) {
			if (cursor < html.length) nodes.push({ type: "text", raw: html.slice(cursor) });
			break;
		}
		if (open > cursor) nodes.push({ type: "text", raw: html.slice(cursor, open) });

		const match = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)(\/?)>/.exec(html.slice(open));
		if (!match) {
			// Not a tag we can read. Take one character as text so the loop always
			// advances, rather than spinning on a stray angle bracket.
			nodes.push({ type: "text", raw: html.slice(open, open + 1) });
			cursor = open + 1;
			continue;
		}

		const [whole, rawName = "", attrs = "", selfClosing] = match;
		const name = rawName.toLowerCase();
		const afterOpen = open + whole.length;

		if (selfClosing || VOID_TAGS.has(name)) {
			nodes.push({ type: "element", name, attrs, inner: "", raw: whole });
			cursor = afterOpen;
			continue;
		}

		let depth = 1;
		let scan = afterOpen;
		let innerEnd = -1;
		const tagRe = new RegExp(`<(/?)${name}(?=[\\s/>])[^<>]*>|<(/?)${name}>`, "gi");
		tagRe.lastIndex = afterOpen;
		let step: RegExpExecArray | null;
		while ((step = tagRe.exec(html)) !== null) {
			const closing = step[0].startsWith("</");
			depth += closing ? -1 : 1;
			if (depth === 0) {
				innerEnd = step.index;
				scan = step.index + step[0].length;
				break;
			}
		}

		if (innerEnd < 0) {
			// Unclosed. Everything that is left belongs to it, which is what a
			// browser would decide too.
			nodes.push({ type: "element", name, attrs, inner: html.slice(afterOpen), raw: html.slice(open) });
			break;
		}

		nodes.push({
			type: "element",
			name,
			attrs,
			inner: html.slice(afterOpen, innerEnd),
			raw: html.slice(open, scan),
		});
		cursor = scan;
	}

	return nodes;
}

type Declarations = Map<string, string>;

function readStyle(attrs: string): Declarations {
	const map: Declarations = new Map();
	const style = attribute(attrs, "style");
	if (!style) return map;
	for (const part of unescapeAttr(style).split(";")) {
		const colon = part.indexOf(":");
		if (colon < 0) continue;
		const property = part.slice(0, colon).trim().toLowerCase();
		const value = part.slice(colon + 1).trim();
		if (property && value) map.set(property, value);
	}
	return map;
}

/** Attribute values come back HTML-escaped, because that is how they were written. */
function unescapeAttr(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function px(map: Declarations, property: string): number | null {
	const value = map.get(property);
	if (!value) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** The properties the controls above own. Whatever is left is the author's own
 * CSS and is handed back to the custom field, so a round trip loses nothing. */
function leftoverCss(map: Declarations, owned: string[]): string | null {
	const rest: string[] = [];
	const ownedSet = new Set(owned);
	for (const [property, value] of map) {
		if (ownedSet.has(property)) continue;
		rest.push(`${property}:${value}`);
	}
	const css = sanitiseDeclarations(rest.join(";"));
	return css || null;
}

const BOX_PROPERTIES = ["background", "background-color", "padding", "border", "border-radius"];

function readPadding(map: Declarations): MailSpacing {
	const value = map.get("padding");
	if (!value) return noSpacing();
	const parts = value.split(/\s+/).map((part) => Number.parseFloat(part));
	if (parts.some((part) => !Number.isFinite(part))) return noSpacing();
	const [a = 0, b = a, c = a, d = b] = parts;
	if (parts.length === 1) return { top: a, right: a, bottom: a, left: a };
	if (parts.length === 2) return { top: a, right: b, bottom: a, left: b };
	if (parts.length === 3) return { top: a, right: b, bottom: c, left: b };
	return { top: a, right: b, bottom: c, left: d };
}

function readBox(map: Declarations, extraOwned: string[] = []): MailBoxStyle {
	const border = map.get("border") ?? "";
	const borderMatch = /^(\d+(?:\.\d+)?)px\s+solid\s+(#[0-9a-f]{3,6})$/i.exec(border.trim());
	return {
		background: toColor(map.get("background") ?? map.get("background-color")),
		padding: readPadding(map),
		borderWidth: borderMatch ? Number.parseFloat(borderMatch[1] ?? "0") : 0,
		borderColor: borderMatch ? toColor(borderMatch[2]) : null,
		borderRadius: px(map, "border-radius") ?? 0,
		customCss: leftoverCss(map, [...BOX_PROPERTIES, ...extraOwned]),
	};
}

const TEXT_PROPERTIES = ["color", "font-size", "line-height", "font-weight", "text-align", "margin"];

function readTextStyle(map: Declarations): MailTextStyle {
	const weightValue = map.get("font-weight");
	const weight: MailWeight =
		weightValue === "700" || weightValue === "bold"
			? "bold"
			: weightValue === "600"
				? "semibold"
				: weightValue === "500"
					? "medium"
					: "normal";
	return {
		color: toColor(map.get("color")),
		fontSize: px(map, "font-size"),
		lineHeight: map.get("line-height") ? Number.parseFloat(map.get("line-height") ?? "") || null : null,
		weight,
		align: toAlignText(map.get("text-align")),
	};
}

function readGrow(map: Declarations): number {
	const flex = map.get("flex");
	if (!flex) return 0;
	const parsed = Number.parseFloat(flex);
	return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 12) : 0;
}

function rawBlock(html: string): MailBlock {
	return { id: randomUUID(), kind: "html", html: sanitiseFragment(html), box: emptyBox(), grow: 0 };
}

function readBlock(node: Extract<Node, { type: "element" }>): MailBlock {
	const kind = attribute(node.attrs, "data-juno-block");
	const id = attribute(node.attrs, "data-juno-id") ?? randomUUID();
	const map = readStyle(node.attrs);
	const grow = readGrow(map);

	switch (kind) {
		case "heading": {
			const level = node.name === "h1" ? 1 : node.name === "h3" ? 3 : 2;
			return {
				id,
				kind: "heading",
				level,
				content: unescapeAttr(node.inner.replace(/<[^>]+>/g, "")),
				text: readTextStyle(map),
				box: readBox(map, [...TEXT_PROPERTIES, "flex"]),
				grow,
			};
		}
		case "text":
			return {
				id,
				kind: "text",
				html: sanitiseFragment(node.inner),
				text: readTextStyle(map),
				box: readBox(map, [...TEXT_PROPERTIES, "flex"]),
				grow,
			};
		case "button":
			return {
				id,
				kind: "button",
				label: unescapeAttr(node.inner.replace(/<[^>]+>/g, "")),
				href: safeHref(unescapeAttr(attribute(node.attrs, "href") ?? "")) ?? "",
				background: colorOr(map.get("background"), "#4a3fa0"),
				color: colorOr(map.get("color"), "#ffffff"),
				radius: px(map, "border-radius") ?? 4,
				box: {
					...emptyBox(),
					padding: readPadding(map),
					customCss: leftoverCss(map, [
						"display",
						"text-decoration",
						"background",
						"color",
						"border-radius",
						"padding",
						"flex",
					]),
				},
				grow,
			};
		case "image":
			return {
				id,
				kind: "image",
				src: safeImageSrc(unescapeAttr(attribute(node.attrs, "src") ?? "")) ?? "",
				alt: unescapeAttr(attribute(node.attrs, "alt") ?? ""),
				width: px(map, "width"),
				align: map.get("margin") === "0 auto" ? "center" : map.get("margin-left") === "auto" ? "right" : "left",
				box: readBox(map, ["display", "max-width", "width", "height", "margin", "margin-left", "flex"]),
				grow,
			};
		case "divider": {
			const top = map.get("border-top") ?? "";
			const dividerMatch = /^(\d+(?:\.\d+)?)px\s+solid\s+(#[0-9a-f]{3,6})$/i.exec(top.trim());
			return {
				id,
				kind: "divider",
				color: dividerMatch ? colorOr(dividerMatch[2], "#e3e2ec") : "#e3e2ec",
				thickness: dividerMatch ? Number.parseFloat(dividerMatch[1] ?? "1") : 1,
				box: { ...emptyBox(), padding: readPadding(map), customCss: leftoverCss(map, ["border", "border-top", "width", "padding", "flex"]) },
				grow,
			};
		}
		case "spacer":
			return { id, kind: "spacer", height: px(map, "height") ?? 16, grow };
		case "field": {
			const inputKey = attribute(node.attrs, "data-juno-field") ?? "";
			return {
				id,
				kind: "field",
				inputKey: unescapeAttr(inputKey),
				text: readTextStyle(map),
				box: readBox(map, [...TEXT_PROPERTIES, "display", "max-width", "height", "flex"]),
				grow,
			};
		}
		case "html":
			return { id, kind: "html", html: sanitiseFragment(node.inner), box: readBox(map, ["flex"]), grow };
		default:
			return rawBlock(node.raw);
	}
}

function readSectionLayout(map: Declarations): MailSectionLayout {
	if (map.get("display") === "grid") {
		const columns = /repeat\((\d+)/.exec(map.get("grid-template-columns") ?? "");
		return {
			kind: "grid",
			columns: columns ? Math.min(Math.max(Number.parseInt(columns[1] ?? "2", 10), 1), 6) : 2,
			gap: px(map, "gap") ?? 12,
			align: alignFromCss(map.get("align-items")),
		};
	}
	return {
		kind: "flex",
		direction: map.get("flex-direction") === "row" ? "row" : "column",
		justify: justifyFromCss(map.get("justify-content")),
		align: alignFromCss(map.get("align-items")),
		gap: px(map, "gap") ?? 12,
		wrap: map.get("flex-wrap") === "wrap",
	};
}

function justifyFromCss(value: string | undefined): MailJustify {
	switch (value) {
		case "center":
			return "center";
		case "flex-end":
		case "end":
			return "end";
		case "space-between":
			return "between";
		case "space-around":
			return "around";
		default:
			return "start";
	}
}

function alignFromCss(value: string | undefined): MailAlign {
	switch (value) {
		case "center":
			return "center";
		case "flex-start":
		case "start":
			return "start";
		case "flex-end":
		case "end":
			return "end";
		default:
			return "stretch";
	}
}

const SECTION_PROPERTIES = [
	"display",
	"flex-direction",
	"justify-content",
	"align-items",
	"gap",
	"flex-wrap",
	"grid-template-columns",
];

function readSection(node: Extract<Node, { type: "element" }>): MailSection {
	const map = readStyle(node.attrs);
	const blocks: MailBlock[] = [];
	// Markup between two blocks is somebody's hand-written HTML. It becomes a
	// raw block in the order it was written, which is what "editable, within
	// what works" has to mean if an edit is never to lose anything.
	let loose = "";
	const flush = () => {
		if (loose.trim()) blocks.push(rawBlock(loose));
		loose = "";
	};

	for (const child of splitTopLevel(node.inner)) {
		if (child.type === "text") {
			loose += child.raw;
			continue;
		}
		if (attribute(child.attrs, "data-juno-block")) {
			flush();
			blocks.push(readBlock(child));
			continue;
		}
		loose += child.raw;
	}
	flush();

	return {
		id: attribute(node.attrs, "data-juno-id") ?? randomUUID(),
		name: unescapeAttr(attribute(node.attrs, "data-juno-section") || "Section"),
		layout: readSectionLayout(map),
		box: readBox(map, [...SECTION_PROPERTIES, "flex"]),
		blocks,
	};
}

/**
 * Reads compiled HTML back into a canvas, so the code view can be typed in
 * rather than only read.
 *
 * It never refuses and it never drops: markup it recognises comes back as the
 * block it was, and markup it does not comes back as a raw `html` block in the
 * position it was written. An author can therefore hand-write a table in the
 * code view, switch to the canvas, and find it sitting there as a block they
 * can move, rather than finding it gone.
 *
 * What it cannot promise is that a hand-written document round trips to
 * byte-identical HTML. A raw block is re-emitted inside the div that holds it,
 * so the structure is kept and the exact indentation is not. That is the
 * honest limit of "editable, within what works", and the editor says so.
 */
export function layoutFromHtml(html: string, previous?: MailLayout | null): MailLayout {
	const base = previous ?? emptyLayout();
	const nodes = splitTopLevel(html);
	const canvas = nodes.find(
		(node): node is Extract<Node, { type: "element" }> =>
			node.type === "element" && attribute(node.attrs, "data-juno-canvas") !== null,
	);

	if (!canvas) {
		// Hand-written from nothing, or pasted in. One section holding it all,
		// which the author can then break up on the canvas.
		const section = emptySection("Body");
		section.blocks = html.trim() ? [rawBlock(html)] : [];
		return { ...base, sections: [section] };
	}

	const map = readStyle(canvas.attrs);
	const sections: MailSection[] = [];
	let loose = "";
	const flush = () => {
		if (loose.trim()) {
			const section = emptySection("Section");
			section.blocks = [rawBlock(loose)];
			sections.push(section);
		}
		loose = "";
	};

	for (const child of splitTopLevel(canvas.inner)) {
		if (child.type === "text") {
			loose += child.raw;
			continue;
		}
		if (attribute(child.attrs, "data-juno-section") !== null) {
			flush();
			sections.push(readSection(child));
			continue;
		}
		loose += child.raw;
	}
	flush();

	return {
		version: 1,
		width: px(map, "max-width") ?? base.width,
		minHeight: px(map, "min-height") ?? 0,
		background: toColor(map.get("background")),
		customCss: leftoverCss(map, ["max-width", "min-height", "background"]),
		sections: sections.length > 0 ? sections : [emptySection("Body")],
	};
}
