/**
 * Turns the mail template canvas into the HTML a message body is made of, and
 * reads that HTML back into a canvas.
 *
 * Pure and Electron-free on purpose: the editor, the service and the tests all
 * call these directly, and nothing below them ever learns that a canvas
 * exists. `canvasShell` (mail-html.ts) puts whatever `compileLayout` returns
 * into a document with nothing around it, and the breakpoints'
 * `breakpointCss` into that document's head, so this function emits a body
 * fragment and never a document.
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
	MailBlockOverride,
	MailBoxStyle,
	MailBreakpoint,
	MailColor,
	MailCorners,
	MailDirection,
	MailEffect,
	MailFill,
	MailFont,
	MailFontFallback,
	MailJustify,
	MailLayout,
	MailSection,
	MailSectionLayout,
	MailSectionOverride,
	MailSelfAlign,
	MailSides,
	MailSpacing,
	MailStrokeStyle,
	MailTextAlign,
	MailTextCase,
	MailTextDecoration,
	MailTextStyle,
	MailVerticalAlign,
	MailWeight,
	TemplateInput,
} from "../../shared/types";
import { escapeHtml } from "./template-render";

/** What every mail client agrees a message body is. Also mailShell's table. */
export const DEFAULT_WIDTH = 600;
const MIN_WIDTH = 280;
/** Wide enough to design a message for a desktop client that is given the room. */
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 20000;

/* ----------------------------------------------------------------- defaults */

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

/** A flat colour as a fill, which is what every fill control starts from. */
export function solidFill(color: MailColor): MailFill {
	return { kind: "solid", color, hidden: false };
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
	return {
		id: randomUUID(),
		name,
		hidden: false,
		alignSelf: "auto",
		layout: stackLayout(),
		box: emptyBox(),
		blocks: [],
	};
}

/**
 * A canvas with nothing on it. It fills the mail client, because a message
 * is read at whatever width the client has, and the 600 is only the width it
 * is drawn at until a breakpoint says otherwise.
 */
export function emptyLayout(): MailLayout {
	return {
		version: 1,
		width: DEFAULT_WIDTH,
		widthMode: "fill",
		minHeight: 320,
		fill: null,
		fonts: [],
		customCss: null,
		sections: [emptySection("Body")],
		breakpoints: [],
	};
}

/**
 * A new block of each kind, with values that render as something visible. A
 * button and a picture hug their content: in a section that stretches what is
 * in it, a button would otherwise be sent as a bar the width of the message.
 */
export function newBlock(kind: MailBlock["kind"]): MailBlock {
	const common = { id: randomUUID(), grow: 0, alignSelf: "auto" as const, hidden: false };
	switch (kind) {
		case "heading":
			return { ...common, kind, level: 2, content: "Titel", text: { ...defaultText(), weight: "semibold" }, box: emptyBox() };
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

/* ------------------------------------------------------------------- fonts */

/**
 * The families every mail client already has, and the stack each one is
 * written as. A block that names one of these needs no link.
 */
export const SYSTEM_FONTS: Record<string, string> = {
	Arial: "Arial, Helvetica, sans-serif",
	Helvetica: "Helvetica, Arial, sans-serif",
	Verdana: "Verdana, Geneva, sans-serif",
	Tahoma: "Tahoma, Verdana, sans-serif",
	"Trebuchet MS": "'Trebuchet MS', Helvetica, sans-serif",
	Georgia: "Georgia, 'Times New Roman', serif",
	"Times New Roman": "'Times New Roman', Times, serif",
	"Courier New": "'Courier New', Courier, monospace",
};

/** What a linked font stands on when the client will not load it. */
export const FALLBACK_STACKS: Record<MailFontFallback, string> = {
	sans: "Arial, Helvetica, sans-serif",
	serif: "Georgia, 'Times New Roman', serif",
	mono: "'Courier New', Courier, monospace",
};

export const FONT_WEIGHTS: Record<MailWeight, number> = {
	thin: 100,
	extralight: 200,
	light: 300,
	normal: 400,
	medium: 500,
	semibold: 600,
	bold: 700,
	extrabold: 800,
	black: 900,
};

/** At most this many linked typefaces. Each one is a request the reader's client makes. */
const MAX_FONTS = 6;

/**
 * A family name and nothing else.
 *
 * Letters, digits, spaces and hyphens: every family Google serves fits, and
 * nothing that fits can close the quote it is written in, so a family cannot
 * become a second way to write a declaration into a style attribute.
 */
export function toFamily(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().replace(/\s+/g, " ");
	return /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/.test(trimmed) ? trimmed : null;
}

/** An https stylesheet for a linked font, or nothing. */
export function safeStylesheetHref(raw: string): string | null {
	const trimmed = raw.trim();
	if (!/^https:\/\/[^\s"'<>()\\]+$/i.test(trimmed) || trimmed.length > 500) return null;
	try {
		return new URL(trimmed).protocol === "https:" ? trimmed : null;
	} catch {
		return null;
	}
}

/**
 * The Google Fonts stylesheet for a family, built from its name.
 *
 * The css2 API wants the axis tuples in order, italics after uprights, and it
 * answers with an error for a weight the family does not have, which is why
 * the editor loads a font before offering it rather than trusting the list.
 */
export function googleFontHref(family: string, weights: number[], italic: boolean): string {
	const sorted = [...new Set(weights)].sort((a, b) => a - b);
	const axis = italic
		? `ital,wght@${[...sorted.map((weight) => `0,${weight}`), ...sorted.map((weight) => `1,${weight}`)].join(";")}`
		: `wght@${sorted.join(";")}`;
	return `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ /g, "+")}:${axis}&display=swap`;
}

/** Where a font's stylesheet is, or null for a linked font with no usable address. */
export function fontHref(font: MailFont): string | null {
	return font.source === "google" ? googleFontHref(font.family, font.weights, font.italic) : font.href;
}

/** The stylesheets a message links, in the order the fonts were added. */
export function fontLinks(layout: MailLayout | null): string[] {
	if (!layout) return [];
	return layout.fonts.map(fontHref).filter((href): href is string => href !== null);
}

/**
 * How a family is written into `font-family`.
 *
 * A system family is its stack. A linked family is quoted and stood on its
 * fallback, so a client that ignores the link still shows something of the
 * same kind. A family that is neither, which is what a pasted block or a
 * removed font leaves behind, stands on a plain sans serif.
 */
export function fontStack(family: string, fonts: MailFont[]): string {
	const system = SYSTEM_FONTS[family];
	if (system) return system;
	const linked = fonts.find((font) => font.family === family);
	return `'${family}', ${FALLBACK_STACKS[linked?.fallback ?? "sans"]}`;
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
 * Refusing anything that is not `#rgb`, `#rrggbb` or `#rrggbbaa` is what keeps
 * a colour field from becoming a second way to write arbitrary CSS:
 * `red;position:fixed` is a perfectly good-looking string until it is
 * concatenated into a style attribute. A colour whose opacity is whole is kept
 * as its six digits, so the same colour is only ever written one way.
 */
export function toColor(value: unknown): MailColor | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (/^#[0-9a-f]{8}$/i.test(trimmed)) return /ff$/i.test(trimmed) ? trimmed.slice(0, 7) : trimmed;
	return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : null;
}

/** A colour with no opacity of its own, for an HTML attribute that only takes those. */
function toOpaqueColor(value: unknown): MailColor | null {
	const color = toColor(value);
	return color && color.length !== 9 ? color : null;
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
	return typeof value === "string" && value in FONT_WEIGHTS ? (value as MailWeight) : "normal";
}

function toSelfAlign(value: unknown): MailSelfAlign {
	return value === "start" || value === "center" || value === "end" || value === "stretch" ? value : "auto";
}

function toVerticalAlign(value: unknown): MailVerticalAlign {
	return value === "middle" || value === "bottom" ? value : "top";
}

function toDecoration(value: unknown): MailTextDecoration {
	return value === "underline" || value === "strike" ? value : "none";
}

function toTextCase(value: unknown): MailTextCase {
	return value === "upper" || value === "lower" || value === "title" ? value : "none";
}

function toFallback(value: unknown): MailFontFallback {
	return value === "serif" || value === "mono" ? value : "sans";
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

/**
 * A fill, from whatever is stored.
 *
 * A canvas written before fills existed carries a plain `background` colour,
 * and that is read as a solid fill rather than dropped. An upgrade that
 * quietly empties somebody's backgrounds is the kind of data loss nobody
 * notices until the message has gone out.
 */
function parseFill(raw: unknown, legacy?: unknown): MailFill | null {
	if (isRecord(raw)) {
		const hidden = raw.hidden === true;
		if (raw.kind === "gradient") {
			return {
				kind: "gradient",
				angle: toNum(raw.angle, 180, 0, 360),
				from: colorOr(raw.from, "#ffffff"),
				to: colorOr(raw.to, "#000000"),
				hidden,
			};
		}
		const color = toColor(raw.color);
		return color ? { kind: "solid", color, hidden } : null;
	}
	const carried = toColor(legacy);
	return carried ? { kind: "solid", color: carried, hidden: false } : null;
}

function toStrokeStyle(value: unknown): MailStrokeStyle {
	return value === "dashed" || value === "dotted" ? value : "solid";
}

function parseCorners(raw: unknown): MailCorners | null {
	if (!isRecord(raw)) return null;
	return {
		topLeft: toNum(raw.topLeft, 0, 0, 80),
		topRight: toNum(raw.topRight, 0, 0, 80),
		bottomRight: toNum(raw.bottomRight, 0, 0, 80),
		bottomLeft: toNum(raw.bottomLeft, 0, 0, 80),
	};
}

function parseEffect(raw: unknown): MailEffect | null {
	if (!isRecord(raw)) return null;
	const hidden = raw.hidden === true;
	if (raw.kind === "blur") return { kind: "blur", radius: toNum(raw.radius, 4, 0, 60), hidden };
	if (raw.kind !== "shadow") return null;
	return {
		kind: "shadow",
		inset: raw.inset === true,
		x: toNum(raw.x, 0, -200, 200),
		y: toNum(raw.y, 2, -200, 200),
		blur: toNum(raw.blur, 6, 0, 200),
		spread: toNum(raw.spread, 0, -100, 100),
		// A shadow carries its opacity beside its colour, so the colour is kept solid.
		color: (toColor(raw.color) ?? "#16161d").slice(0, 7),
		opacity: toNum(raw.opacity, 0.2, 0, 1),
		hidden,
	};
}

/** Enough to stack a shadow on a glow. Past that it is a message that renders
 * slowly on a phone and a panel nobody can read. */
const MAX_EFFECTS = 8;

function parseEffects(raw: unknown): MailEffect[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map(parseEffect)
		.filter((effect): effect is MailEffect => effect !== null)
		.slice(0, MAX_EFFECTS);
}

function parseSides(raw: unknown): MailSides {
	if (!isRecord(raw)) return allSides();
	return { top: raw.top !== false, right: raw.right !== false, bottom: raw.bottom !== false, left: raw.left !== false };
}

function parseBox(raw: unknown): MailBoxStyle {
	if (!isRecord(raw)) return emptyBox();
	return {
		fill: parseFill(raw.fill, raw.background),
		padding: parseSpacing(raw.padding),
		borderWidth: toNum(raw.borderWidth, 0, 0, 40),
		borderColor: toColor(raw.borderColor),
		borderStyle: toStrokeStyle(raw.borderStyle),
		borderSides: parseSides(raw.borderSides),
		strokeHidden: raw.strokeHidden === true,
		borderRadius: toNum(raw.borderRadius, 0, 0, 80),
		corners: parseCorners(raw.corners),
		opacity: toNum(raw.opacity, 1, 0, 1),
		effects: parseEffects(raw.effects),
		width: toNullableNum(raw.width, 8, MAX_WIDTH),
		minHeight: toNullableNum(raw.minHeight, 1, MAX_HEIGHT),
		clip: raw.clip === true,
		customCss: sanitiseDeclarations(toStr(raw.customCss)) || null,
	};
}

function parseTextStyle(raw: unknown): MailTextStyle {
	if (!isRecord(raw)) return defaultText();
	return {
		color: toColor(raw.color),
		fontFamily: toFamily(raw.fontFamily),
		fontSize: toNullableNum(raw.fontSize, 8, 96),
		lineHeight: toNullableNum(raw.lineHeight, 0.8, 4),
		letterSpacing: toNullableNum(raw.letterSpacing, -10, 40),
		weight: toWeight(raw.weight),
		italic: raw.italic === true,
		decoration: toDecoration(raw.decoration),
		transform: toTextCase(raw.transform),
		align: toAlignText(raw.align),
		verticalAlign: toVerticalAlign(raw.verticalAlign),
	};
}

const WEIGHT_STEPS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);

function parseFont(raw: unknown): MailFont | null {
	if (!isRecord(raw)) return null;
	const family = toFamily(raw.family);
	if (!family) return null;
	const source = raw.source === "link" ? "link" : "google";
	const weights = Array.isArray(raw.weights)
		? [
				...new Set(
					raw.weights.filter((weight): weight is number => typeof weight === "number" && WEIGHT_STEPS.has(weight)),
				),
			].sort((a, b) => a - b)
		: [];
	return {
		family,
		source,
		// A linked font whose address is not usable is kept rather than dropped,
		// so the author sees it and can correct it. It links nothing meanwhile.
		href: source === "link" ? safeStylesheetHref(toStr(raw.href)) : null,
		weights: weights.length > 0 ? weights : [400, 700],
		italic: raw.italic === true,
		fallback: toFallback(raw.fallback),
	};
}

function parseFonts(raw: unknown): MailFont[] {
	if (!Array.isArray(raw)) return [];
	const fonts: MailFont[] = [];
	for (const entry of raw) {
		const font = parseFont(entry);
		// One family, one entry: two links for the same name is the second one
		// winning in some clients and the first in others.
		if (font && !fonts.some((other) => other.family === font.family)) fonts.push(font);
	}
	return fonts.slice(0, MAX_FONTS);
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
	const common = {
		id: toId(raw.id),
		grow: toNum(raw.grow, 0, 0, 12),
		alignSelf: toSelfAlign(raw.alignSelf),
		hidden: raw.hidden === true,
	};
	const box = parseBox(raw.box);

	switch (raw.kind) {
		case "heading": {
			const level = raw.level === 1 || raw.level === 3 ? raw.level : 2;
			return { ...common, kind: "heading", level, content: toStr(raw.content), text: parseTextStyle(raw.text), box };
		}
		case "button":
			return {
				...common,
				kind: "button",
				label: toStr(raw.label),
				href: safeHref(toStr(raw.href)) ?? "",
				background: colorOr(raw.background, "#4a3fa0"),
				color: colorOr(raw.color, "#ffffff"),
				radius: toNum(raw.radius, 4, 0, 80),
				// A button stored before it had type of its own keeps the weight
				// it was drawn with.
				text: isRecord(raw.text) ? parseTextStyle(raw.text) : { ...defaultText(), weight: "semibold" },
				box,
			};
		case "image":
			return {
				...common,
				kind: "image",
				src: safeImageSrc(toStr(raw.src)) ?? "",
				alt: toStr(raw.alt),
				width: toNullableNum(raw.width, 8, MAX_WIDTH),
				align: toAlignText(raw.align),
				// A picture has a width of its own, and the box's would be a second one.
				box: { ...box, width: null },
			};
		case "divider":
			return {
				...common,
				kind: "divider",
				color: colorOr(raw.color, "#e3e2ec"),
				thickness: toNum(raw.thickness, 1, 1, 20),
				box,
			};
		case "spacer":
			return { ...common, kind: "spacer", height: toNum(raw.height, 16, 1, 400) };
		case "field":
			return { ...common, kind: "field", inputKey: toStr(raw.inputKey).trim(), text: parseTextStyle(raw.text), box };
		case "html": {
			if (typeof raw.css === "string") {
				return { ...common, kind: "html", html: sanitiseMarkup(toStr(raw.html)), css: sanitiseDeclarations(raw.css) };
			}
			// A raw block from before blocks were code had a box around its
			// markup. The box becomes the CSS of a div holding the markup, which
			// is exactly what it compiled to, so nothing moves.
			const css = boxDeclarations(box)
				.filter((declaration): declaration is string => Boolean(declaration))
				.join(";");
			const html = sanitiseMarkup(toStr(raw.html));
			return { ...common, kind: "html", html: css ? `<div>${html}</div>` : html, css };
		}
		case "text":
			return { ...common, kind: "text", html: sanitiseFragment(toStr(raw.html)), text: parseTextStyle(raw.text), box };
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
		hidden: raw.hidden === true,
		alignSelf: toSelfAlign(raw.alignSelf),
		layout: parseSectionLayout(raw.layout),
		box: parseBox(raw.box),
		blocks,
	};
}

/* -------------------------------------------------------------- breakpoints */

/** A breakpoint for a phone, a tablet and whatever else, and no more. */
const MAX_BREAKPOINTS = 4;

/** The fields of a block a breakpoint can change, beyond the three every block has. */
const KIND_STYLE: Record<MailBlock["kind"], (keyof MailBlockOverride)[]> = {
	text: [],
	heading: [],
	button: ["background", "color", "radius"],
	image: ["width", "align"],
	divider: ["color", "thickness"],
	spacer: ["height"],
	field: [],
	html: [],
};

const COMMON_STYLE = ["hidden", "grow", "alignSelf"] as const;

/** Keys that would reach an object's prototype rather than name an entry in it. */
function unsafeKey(key: string): boolean {
	return key === "__proto__" || key === "constructor" || key === "prototype";
}

function entryOf(record: unknown, key: string): unknown {
	return isRecord(record) && !unsafeKey(key) && Object.prototype.hasOwnProperty.call(record, key)
		? record[key]
		: undefined;
}

/**
 * What a breakpoint changes about one block, checked the way the block itself
 * is: the block is parsed as it would be with the change applied, and the
 * override keeps the parsed value of each field it named. So an override can
 * hold nothing the block could not, and a field it names stays named even when
 * it matches the default, because a narrower breakpoint may be putting back
 * what a wider one changed.
 */
function parseBlockOverride(raw: unknown, block: MailBlock): MailBlockOverride | null {
	if (!isRecord(raw)) return null;
	const top = [...COMMON_STYLE, ...KIND_STYLE[block.kind]].filter((key) => key in raw);
	const boxKeys = isRecord(raw.box) && "box" in block ? Object.keys(raw.box).filter((key) => key in block.box) : [];
	const textKeys = isRecord(raw.text) && "text" in block ? Object.keys(raw.text).filter((key) => key in block.text) : [];
	if (top.length === 0 && boxKeys.length === 0 && textKeys.length === 0) return null;

	const merged = parseBlock({
		...block,
		...Object.fromEntries(top.map((key) => [key, raw[key]])),
		...("box" in block && isRecord(raw.box) ? { box: { ...block.box, ...raw.box } } : {}),
		...("text" in block && isRecord(raw.text) ? { text: { ...block.text, ...raw.text } } : {}),
	});
	if (!merged || merged.kind !== block.kind) return null;

	const override: Record<string, unknown> = {};
	const parsed = merged as unknown as Record<string, unknown>;
	for (const key of top) override[key] = parsed[key];
	if ("box" in merged && boxKeys.length > 0) {
		override.box = Object.fromEntries(boxKeys.map((key) => [key, merged.box[key as keyof MailBoxStyle]]));
	}
	if ("text" in merged && textKeys.length > 0) {
		override.text = Object.fromEntries(textKeys.map((key) => [key, merged.text[key as keyof MailTextStyle]]));
	}
	return override as MailBlockOverride;
}

/** The same, for a section. Its layout is changed whole, the way the panel changes it. */
function parseSectionOverride(raw: unknown, section: MailSection): MailSectionOverride | null {
	if (!isRecord(raw)) return null;
	const top = (["hidden", "alignSelf", "layout"] as const).filter((key) => key in raw);
	const boxKeys = isRecord(raw.box) ? Object.keys(raw.box).filter((key) => key in section.box) : [];
	if (top.length === 0 && boxKeys.length === 0) return null;

	const merged = parseSection({
		...section,
		blocks: [],
		...Object.fromEntries(top.map((key) => [key, raw[key]])),
		...(isRecord(raw.box) ? { box: { ...section.box, ...raw.box } } : {}),
	});
	if (!merged) return null;

	const override: Record<string, unknown> = {};
	const parsed = merged as unknown as Record<string, unknown>;
	for (const key of top) override[key] = parsed[key];
	if (boxKeys.length > 0) {
		override.box = Object.fromEntries(boxKeys.map((key) => [key, merged.box[key as keyof MailBoxStyle]]));
	}
	return override as MailSectionOverride;
}

/**
 * The breakpoints, checked against the sections and blocks that are there: an
 * override for something that has gone is dropped rather than kept for a
 * block that might come back with the same id.
 */
function parseBreakpoints(raw: unknown, sections: MailSection[]): MailBreakpoint[] {
	if (!Array.isArray(raw)) return [];
	const out: MailBreakpoint[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const maxWidth = Math.round(toNum(entry.maxWidth, 480, 200, 1600));
		const breakpoint: MailBreakpoint = {
			id: toId(entry.id),
			name: toStr(entry.name).trim().slice(0, 40) || `${maxWidth}`,
			maxWidth,
			sections: {},
			blocks: {},
		};
		for (const section of sections) {
			if (unsafeKey(section.id)) continue;
			const sectionOverride = parseSectionOverride(entryOf(entry.sections, section.id), section);
			if (sectionOverride) breakpoint.sections[section.id] = sectionOverride;
			for (const block of section.blocks) {
				if (unsafeKey(block.id)) continue;
				const blockOverride = parseBlockOverride(entryOf(entry.blocks, block.id), block);
				if (blockOverride) breakpoint.blocks[block.id] = blockOverride;
			}
		}
		out.push(breakpoint);
	}
	return out.slice(0, MAX_BREAKPOINTS);
}

/** A block as a breakpoint draws it. */
export function applyBlockOverride(block: MailBlock, override: MailBlockOverride | undefined): MailBlock {
	if (!override) return block;
	const { box, text, ...top } = override;
	return {
		...block,
		...top,
		...(box && "box" in block ? { box: { ...block.box, ...box } } : {}),
		...(text && "text" in block ? { text: { ...block.text, ...text } } : {}),
	} as MailBlock;
}

/** A section as a breakpoint draws it, blocks and all. */
function applySectionOverride(section: MailSection, breakpoint: MailBreakpoint): MailSection {
	const override = entryOf(breakpoint.sections, section.id) as MailSectionOverride | undefined;
	const { box, ...top } = override ?? ({} as MailSectionOverride);
	return {
		...section,
		...top,
		box: box ? { ...section.box, ...box } : section.box,
		blocks: section.blocks.map((block) =>
			applyBlockOverride(block, entryOf(breakpoint.blocks, block.id) as MailBlockOverride | undefined),
		),
	};
}

/** The breakpoints from the widest down, which is the order their media queries stack in. */
export function widestFirst(breakpoints: MailBreakpoint[]): MailBreakpoint[] {
	return breakpoints
		.map((breakpoint, index) => ({ breakpoint, index }))
		.sort((a, b) => b.breakpoint.maxWidth - a.breakpoint.maxWidth || a.index - b.index)
		.map((entry) => entry.breakpoint);
}

/** The canvas as it is drawn at a breakpoint: the default, then every wider breakpoint, then this one. */
export function layoutAt(layout: MailLayout, breakpointId: string | null): MailLayout {
	if (!breakpointId || !layout.breakpoints.some((breakpoint) => breakpoint.id === breakpointId)) return layout;
	let sections = layout.sections;
	let width = layout.width;
	for (const breakpoint of widestFirst(layout.breakpoints)) {
		sections = sections.map((section) => applySectionOverride(section, breakpoint));
		width = breakpoint.maxWidth;
		if (breakpoint.id === breakpointId) break;
	}
	return { ...layout, width, sections };
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
	const kept = sections.length > 0 ? sections : [emptySection("Body")];
	return {
		version: 1,
		width: toNum(raw.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
		// A canvas saved before the choice existed was sent 600 wide, and it
		// keeps that until somebody says otherwise.
		widthMode: raw.widthMode === "fill" ? "fill" : "fixed",
		minHeight: toNum(raw.minHeight, 320, 0, MAX_HEIGHT),
		fill: parseFill(raw.fill, raw.background),
		fonts: parseFonts(raw.fonts),
		customCss: sanitiseDeclarations(toStr(raw.customCss)) || null,
		sections: kept,
		breakpoints: parseBreakpoints(raw.breakpoints, kept),
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

/** What a code block may carry: an email's worth of structure, and nothing that runs. */
const MARKUP_TAGS = new Set([
	"a",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"small",
	"sup",
	"sub",
	"span",
	"br",
	"p",
	"div",
	"center",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"hr",
	"ul",
	"ol",
	"li",
	"img",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
]);

/** Never content in a message body: dropped together with what is inside them. */
const DROPPED_WITH_CONTENT = ["script", "style", "head", "title", "iframe", "object", "embed", "form", "svg", "noscript", "template"];

/** A whole document pasted in: the wrapper goes, what it wrapped stays. */
const UNWRAPPED = new Set(["html", "body"]);

const TABLE_TAGS = new Set(["table", "tr", "td", "th", "thead", "tbody", "tfoot"]);

/**
 * The attributes a code block keeps, each checked before it is written back.
 *
 * Style goes through the same declaration cleaning as every other style, a
 * link through `safeHref` and a picture through `safeImageSrc`, so an https
 * address is the only kind of address that survives. The rest are the
 * presentation attributes mail HTML still leans on for Outlook, and each is
 * held to the shape of its value: a number, a keyword, a hex colour.
 */
function markupAttributes(name: string, attrs: string): string {
	const kept: string[] = [];
	const style = sanitiseDeclarations(unescapeAttr(attribute(attrs, "style") ?? ""));
	if (style) kept.push(`style="${escapeHtml(style)}"`);
	if (name === "a") {
		const href = safeHref(unescapeAttr(attribute(attrs, "href") ?? ""));
		if (href) kept.push(`href="${escapeHtml(href)}"`);
	}
	if (name === "img") {
		const src = safeImageSrc(unescapeAttr(attribute(attrs, "src") ?? ""));
		if (src) kept.push(`src="${escapeHtml(src)}"`);
		const alt = attribute(attrs, "alt");
		kept.push(`alt="${escapeHtml(unescapeAttr(alt ?? ""))}"`);
	}
	if (name === "img" || TABLE_TAGS.has(name)) {
		for (const key of ["width", "height"]) {
			const value = attribute(attrs, key);
			if (value && /^\d{1,4}%?$/.test(value)) kept.push(`${key}="${value}"`);
		}
	}
	if (TABLE_TAGS.has(name) || name === "div" || name === "p" || name.startsWith("h")) {
		const align = attribute(attrs, "align");
		if (align && /^(left|center|right|justify)$/i.test(align)) kept.push(`align="${align.toLowerCase()}"`);
	}
	if (TABLE_TAGS.has(name)) {
		const valign = attribute(attrs, "valign");
		if (valign && /^(top|middle|bottom|baseline)$/i.test(valign)) kept.push(`valign="${valign.toLowerCase()}"`);
		const bgcolor = attribute(attrs, "bgcolor");
		if (bgcolor && toOpaqueColor(bgcolor)) kept.push(`bgcolor="${bgcolor}"`);
		for (const key of ["colspan", "rowspan", "cellpadding", "cellspacing", "border"]) {
			const value = attribute(attrs, key);
			if (value && /^\d{1,3}$/.test(value)) kept.push(`${key}="${value}"`);
		}
		if (name === "table" && attribute(attrs, "role") === "presentation") kept.push('role="presentation"');
	}
	return kept.length > 0 ? ` ${kept.join(" ")}` : "";
}

/**
 * The markup a code block is allowed to carry.
 *
 * Wider than `sanitiseFragment`, because a block converted to HTML or pasted
 * from another email is headings, tables and pictures rather than a sentence,
 * and just as strict about what can run. Comments go, and so do scripts,
 * styles, frames and forms with everything inside them, because none of that
 * is ever something a reader sees. A tag outside the set is escaped to visible
 * text, the same rule the inline sanitiser keeps, so nothing disappears
 * without trace.
 */
export function sanitiseMarkup(html: string): string {
	let source = html.replace(/<!--[\s\S]*?-->/g, "");
	for (const tag of DROPPED_WITH_CONTENT) {
		source = source
			.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "")
			.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
	}

	let out = "";
	let cursor = 0;
	for (const match of source.matchAll(TAG_RE)) {
		const start = match.index ?? 0;
		out += escapeHtml(source.slice(cursor, start));
		cursor = start + match[0].length;

		const closing = Boolean(match[1]);
		const name = (match[2] ?? "").toLowerCase();
		const attrs = match[3] ?? "";

		if (UNWRAPPED.has(name)) continue;
		if (!MARKUP_TAGS.has(name)) {
			out += escapeHtml(match[0]);
			continue;
		}
		if (name === "br" || name === "hr" || name === "img") {
			if (!closing) out += `<${name}${markupAttributes(name, attrs)}>`;
			continue;
		}
		out += closing ? `</${name}>` : `<${name}${markupAttributes(name, attrs)}>`;
	}
	out += escapeHtml(source.slice(cursor));
	// Entities the author wrote come back escaped once too many; put the ones
	// that are plainly entities back.
	return out.replace(/&amp;(#\d+|#x[0-9a-f]+|[a-z]+);/gi, "&$1;");
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

/**
 * A hex colour and an alpha, as `rgba()`.
 *
 * Generated rather than typed, so the value can carry nothing but numbers,
 * which is what keeps a colour control from becoming a second way to write
 * arbitrary CSS. A colour with an opacity of its own has it multiplied in.
 */
function rgba(color: MailColor, opacity: number): string {
	const hex = color.slice(1);
	const full =
		hex.length === 3
			? hex
					.split("")
					.map((part) => part + part)
					.join("")
			: hex;
	const r = Number.parseInt(full.slice(0, 2), 16);
	const g = Number.parseInt(full.slice(2, 4), 16);
	const b = Number.parseInt(full.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${Number((opacity * alphaOf(color)).toFixed(3))})`;
}

/** A colour's own opacity, from the two digits after the six. */
function alphaOf(color: MailColor): number {
	return color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1;
}

/** The colour with its opacity taken off, for a client that cannot read `rgba()`. */
function opaque(color: MailColor): MailColor {
	return color.length === 9 ? color.slice(0, 7) : color;
}

/** A colour as CSS: its hex when it is solid, `rgba()` when it is not. */
function cssColor(color: MailColor): string {
	return alphaOf(color) < 1 ? rgba(color, 1) : color;
}

/**
 * A declaration that carries a colour. One with an opacity is written twice,
 * solid first and `rgba()` second: a client that reads `rgba()` takes the
 * second, and Outlook on Windows, which does not, keeps the first rather than
 * painting nothing.
 */
function colorDeclarations(property: string, color: MailColor, value: (color: string) => string = (c) => c): string[] {
	const solid = `${property}:${value(opaque(color))}`;
	return alphaOf(color) < 1 ? [solid, `${property}:${value(cssColor(color))}`] : [solid];
}

/**
 * A fill, as the declarations a mail client needs.
 *
 * A gradient writes its first stop as a flat `background-color` before the
 * image, so a client that ignores `background-image` paints that colour rather
 * than nothing. Outlook on Windows is the obvious one, and it is not the only
 * one. A hidden fill is Figma's eye, and writes nothing.
 */
function fillDeclarations(fill: MailFill | null): (string | null)[] {
	if (!fill || fill.hidden) return [];
	if (fill.kind === "solid") return colorDeclarations("background-color", fill.color);
	return [
		`background-color:${opaque(fill.from)}`,
		`background-image:linear-gradient(${fill.angle}deg,${cssColor(fill.from)},${cssColor(fill.to)})`,
	];
}

function radiusDeclaration(box: MailBoxStyle): string | null {
	const corners = box.corners;
	if (!corners) return box.borderRadius > 0 ? `border-radius:${box.borderRadius}px` : null;
	if (!corners.topLeft && !corners.topRight && !corners.bottomRight && !corners.bottomLeft) return null;
	return `border-radius:${corners.topLeft}px ${corners.topRight}px ${corners.bottomRight}px ${corners.bottomLeft}px`;
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * The stroke, on every side as one `border`, or on the sides it is drawn on as
 * `border-top` and the rest. A stroke on the bottom of an empty section is
 * how a divider is drawn.
 */
function strokeDeclarations(box: MailBoxStyle): string[] {
	if (box.borderWidth <= 0 || box.strokeHidden) return [];
	const color = box.borderColor ?? "#e3e2ec";
	const value = (c: string) => `${box.borderWidth}px ${box.borderStyle} ${c}`;
	const sides = SIDES.filter((side) => box.borderSides[side]);
	if (sides.length === SIDES.length) return colorDeclarations("border", color, value);
	return sides.flatMap((side) => colorDeclarations(`border-${side}`, color, value));
}

/**
 * The effects, as `box-shadow` and `filter`.
 *
 * Every shadow goes into one comma-separated `box-shadow`, because that is how
 * the property stacks them, and the blurs are added up into a single `filter`,
 * because two `filter` declarations on one element replace each other rather
 * than compose. A hidden effect writes nothing.
 */
function effectDeclarations(effects: MailEffect[]): (string | null)[] {
	const shown = effects.filter((effect) => !effect.hidden);
	const shadows = shown
		.filter((effect): effect is Extract<MailEffect, { kind: "shadow" }> => effect.kind === "shadow")
		.map(
			(effect) =>
				`${effect.inset ? "inset " : ""}${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${rgba(effect.color, effect.opacity)}`,
		);
	const blur = shown.reduce((total, effect) => (effect.kind === "blur" ? total + effect.radius : total), 0);
	return [
		shadows.length > 0 ? `box-shadow:${shadows.join(",")}` : null,
		blur > 0 ? `filter:blur(${blur}px)` : null,
	];
}

function boxDeclarations(box: MailBoxStyle): (string | null)[] {
	const sized = box.width !== null || box.minHeight !== null;
	return [
		...fillDeclarations(box.fill),
		paddingDeclaration(box.padding),
		...strokeDeclarations(box),
		radiusDeclaration(box),
		box.opacity < 1 ? `opacity:${Number(box.opacity.toFixed(3))}` : null,
		...effectDeclarations(box.effects),
		// A fixed width gives way on a narrow screen rather than pushing the
		// message sideways. Both sizes are measured the way Figma measures
		// them, stroke and padding included.
		box.width !== null ? `width:${box.width}px` : null,
		box.width !== null ? "max-width:100%" : null,
		sized ? "box-sizing:border-box" : null,
		box.minHeight !== null ? `min-height:${box.minHeight}px` : null,
		box.clip ? "overflow:hidden" : null,
		// Last, so a hand-written declaration wins over the controls above it.
		box.customCss,
	];
}

const CASE_CSS: Record<MailTextCase, string | null> = {
	none: null,
	upper: "uppercase",
	lower: "lowercase",
	title: "capitalize",
};

const VERTICAL_CSS: Record<MailVerticalAlign, string> = { top: "flex-start", middle: "center", bottom: "flex-end" };

const SELF_CSS: Record<Exclude<MailSelfAlign, "auto">, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
};

type TextOptions = {
	/** A heading left to the client comes out bold whatever the panel said. */
	alwaysWeight?: boolean;
	/** A button's label colour is the button's own, not the text style's. */
	skipColor?: boolean;
};

function textDeclarations(text: MailTextStyle, fonts: MailFont[], options: TextOptions = {}): (string | null)[] {
	const weight = FONT_WEIGHTS[text.weight];
	const textCase = CASE_CSS[text.transform];
	return [
		...(text.color && !options.skipColor ? colorDeclarations("color", text.color) : []),
		text.fontFamily ? `font-family:${fontStack(text.fontFamily, fonts)}` : null,
		text.fontSize ? `font-size:${text.fontSize}px` : null,
		text.lineHeight ? `line-height:${text.lineHeight}` : null,
		text.letterSpacing !== null ? `letter-spacing:${text.letterSpacing}px` : null,
		weight !== 400 || options.alwaysWeight ? `font-weight:${weight}` : null,
		text.italic ? "font-style:italic" : null,
		text.decoration === "underline"
			? "text-decoration:underline"
			: text.decoration === "strike"
				? "text-decoration:line-through"
				: null,
		textCase ? `text-transform:${textCase}` : null,
		text.align !== "left" ? `text-align:${text.align}` : null,
	];
}

/**
 * Text that does not sit at the top of its block.
 *
 * The block becomes a column that pushes one inner span up or down. The span
 * is what keeps it a paragraph: made a flex container directly, every piece of
 * inline markup in it would become an item of its own, and a word in bold
 * would land on a line by itself.
 */
function verticalDeclarations(text: MailTextStyle): string[] {
	if (text.verticalAlign === "top") return [];
	return ["display:flex", "flex-direction:column", `justify-content:${VERTICAL_CSS[text.verticalAlign]}`];
}

function wrapVertical(text: MailTextStyle, inner: string): string {
	return text.verticalAlign === "top" ? inner : `<span data-juno-inner="1" style="display:block">${inner}</span>`;
}

/** How a block takes its place in the section: its share of the room, and where it sits across. */
function placeDeclarations(block: MailBlock): (string | null)[] {
	return [
		block.grow > 0 ? `flex:${block.grow} 1 0%` : null,
		block.alignSelf !== "auto" ? `align-self:${SELF_CSS[block.alignSelf]}` : null,
	];
}

/**
 * Where a section narrower than the frame sits across it. The frame lays its
 * sections one under the next, so this is margins, which every client reads.
 */
function sectionPlaceDeclarations(section: MailSection): string[] {
	if (section.alignSelf === "center") return ["margin-left:auto", "margin-right:auto"];
	if (section.alignSelf === "end") return ["margin-left:auto"];
	return [];
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

/**
 * The tag a text block is written as: a paragraph, which is what it is, unless
 * its own markup has paragraphs in it. A paragraph inside a paragraph is not
 * HTML, and every client would split it somewhere different.
 */
function textTag(html: string): "p" | "div" {
	return /<p[\s>]/i.test(html) ? "div" : "p";
}

/** A code block's markup split into its one root element, when it has exactly one. */
function codeRoot(markup: string): Extract<Node, { type: "element" }> | null {
	const nodes = splitTopLevel(markup).filter((node) => node.type === "element" || node.raw.trim() !== "");
	return nodes.length === 1 && nodes[0]?.type === "element" ? nodes[0] : null;
}

/**
 * The style a block is written with, as the list of declarations. The same
 * list the compiler writes into the element is what a breakpoint is compared
 * against, so what a media query changes is exactly what differs.
 */
function blockDeclarations(block: MailBlock, inputs: TemplateInput[], fonts: MailFont[]): (string | null)[] {
	const place = placeDeclarations(block);
	switch (block.kind) {
		case "heading":
			return [
				"margin:0",
				...textDeclarations(block.text, fonts, { alwaysWeight: true }),
				...verticalDeclarations(block.text),
				...boxDeclarations(block.box),
				...place,
			];
		case "text":
			return [
				"margin:0",
				...textDeclarations(block.text, fonts),
				...verticalDeclarations(block.text),
				...boxDeclarations(block.box),
				...place,
			];
		case "button": {
			const padded = paddingDeclaration(block.box.padding) !== null;
			return [
				"display:inline-block",
				"text-decoration:none",
				...colorDeclarations("background", block.background),
				...colorDeclarations("color", block.color),
				...textDeclarations(block.text, fonts, { skipColor: true }),
				// The button's own fill and radius are the box's, so the appearance
				// controls reach it the same way they reach anything else.
				...boxDeclarations({ ...block.box, fill: null, borderRadius: block.radius }),
				padded ? null : "padding:10px 18px",
				...place,
			];
		}
		case "image":
			if (!safeImageSrc(block.src)) return ["color:#5d5e70", "font-size:12px"];
			return [
				"display:block",
				"max-width:100%",
				block.width ? `width:${block.width}px` : null,
				"height:auto",
				block.align === "center" ? "margin:0 auto" : block.align === "right" ? "margin-left:auto" : null,
				...boxDeclarations({ ...block.box, width: null }),
				...place,
			];
		case "divider":
			return [
				"border:0",
				...colorDeclarations("border-top", block.color, (c) => `${block.thickness}px solid ${c}`),
				block.box.width === null ? "width:100%" : null,
				paddingDeclaration(block.box.padding),
				block.box.opacity < 1 ? `opacity:${Number(block.box.opacity.toFixed(3))}` : null,
				block.box.width !== null ? `width:${block.box.width}px` : null,
				block.box.width !== null ? "max-width:100%" : null,
				block.box.customCss,
				...place,
			];
		case "spacer":
			return [`height:${block.height}px`, "line-height:0", "font-size:0", ...place];
		case "field": {
			if (!block.inputKey) return ["color:#5d5e70", "font-size:12px"];
			const declared = inputs.find((input) => input.key === block.inputKey);
			if (declared?.kind === "image") {
				return ["display:block", "max-width:100%", "height:auto", ...boxDeclarations(block.box), ...place];
			}
			return [...textDeclarations(block.text, fonts), ...boxDeclarations(block.box), ...place];
		}
		case "html": {
			const css = sanitiseDeclarations(block.css) || null;
			const root = codeRoot(sanitiseMarkup(block.html));
			// One element: the CSS is its own, after any style it already carries,
			// so the field in the panel wins over an inline style in the markup.
			const own = root ? unescapeAttr(attribute(root.attrs, "style") ?? "") || null : null;
			return root ? [own, css, ...place] : [css, ...place];
		}
	}
}

/**
 * What the breakpoints add to an element: a class for their media queries to
 * find it by, and, for one that is hidden by default and shown at some
 * breakpoint, the declarations that keep it out of sight until then.
 */
type Marks = { className: string | null; hiddenByDefault: boolean };

const NO_MARKS: Marks = { className: null, hiddenByDefault: false };

/**
 * Hidden by default, shown by a breakpoint. `mso-hide` is what Outlook on
 * Windows reads, because Word draws some `display:none` content anyway.
 * They are always the last two declarations, which is how the reader knows
 * them from the author's own.
 */
const HIDDEN_DECLARATIONS = ["display:none", "mso-hide:all"];

function markAttributes(marks: Marks): string {
	return marks.className ? ` class="${marks.className}"` : "";
}

function compileBlock(
	block: MailBlock,
	inputs: TemplateInput[],
	fonts: MailFont[],
	marks: Marks = NO_MARKS,
): string {
	const marker = ` data-juno-block="${block.kind}" data-juno-id="${escapeHtml(block.id)}"${markAttributes(marks)}`;
	const declarations = blockDeclarations(block, inputs, fonts);
	const style = styleString(marks.hiddenByDefault ? [...declarations, ...HIDDEN_DECLARATIONS] : declarations);

	switch (block.kind) {
		case "heading": {
			const tag = `h${block.level}`;
			return `<${tag}${marker}${style}>${wrapVertical(block.text, escapeHtml(block.content))}</${tag}>`;
		}
		case "text": {
			const html = sanitiseFragment(block.html);
			const tag = textTag(html);
			return `<${tag}${marker}${style}>${wrapVertical(block.text, html)}</${tag}>`;
		}
		case "button": {
			const href = safeHref(block.href);
			// Without a target it is a label, not a link. Emitting an <a> with no
			// href would give the recipient something that looks pressable and is
			// not, which is worse than showing the words.
			return href
				? `<a${marker} href="${escapeHtml(href)}"${style}>${escapeHtml(block.label)}</a>`
				: `<span${marker}${style}>${escapeHtml(block.label)}</span>`;
		}
		case "image": {
			const src = safeImageSrc(block.src);
			if (!src) return `<span${marker}${style}>${escapeHtml(block.alt || "Geen afbeelding")}</span>`;
			return `<img${marker} src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}"${style}>`;
		}
		case "divider":
			return `<hr${marker}${style}>`;
		case "spacer":
			return `<div${marker}${style}>&nbsp;</div>`;
		case "field": {
			if (!block.inputKey) return `<span${marker}${style}>${escapeHtml("Geen invoerveld gekozen")}</span>`;
			const declared = inputs.find((input) => input.key === block.inputKey);
			const token = fieldPlaceholder(block.inputKey);
			const field = ` data-juno-field="${escapeHtml(block.inputKey)}"`;
			// An image input is a picture, not its address. Anything else is text,
			// and the renderer fills the token wherever it lands.
			if (declared?.kind === "image") {
				return `<img${marker}${field} src="${token}" alt="${escapeHtml(declared.label || block.inputKey)}"${style}>`;
			}
			if (declared?.kind === "url") {
				return `<a${marker}${field} href="${token}"${style}>${escapeHtml(declared.label || block.inputKey)}</a>`;
			}
			return `<span${marker}${field}${style}>${token}</span>`;
		}
		case "html": {
			const markup = sanitiseMarkup(block.html);
			const root = codeRoot(markup);
			if (!root) {
				// More than one element, or loose text: the CSS goes on a div around
				// it, and the marker says so, so the code view reads it back the
				// same way.
				return `<div${marker} data-juno-wrap="1"${style}>${markup}</div>`;
			}
			const rest = root.attrs.replace(/\s+style\s*=\s*"[^"]*"/i, "");
			const opening = `<${root.name}${marker}${rest}${style}>`;
			return VOID_TAGS.has(root.name) ? opening : `${opening}${root.inner}</${root.name}>`;
		}
	}
}

function sectionDeclarations(section: MailSection): (string | null)[] {
	return [...layoutDeclarations(section.layout), ...boxDeclarations(section.box), ...sectionPlaceDeclarations(section)];
}

function compileSection(section: MailSection, inputs: TemplateInput[], fonts: MailFont[], rules: BreakpointRules): string {
	const marks = marksFor(section.id, section.hidden, rules);
	if (!marks) return "";
	const declarations = sectionDeclarations(section);
	const style = styleString(marks.hiddenByDefault ? [...declarations, ...HIDDEN_DECLARATIONS] : declarations);
	const children = section.blocks
		.map((block) => {
			const blockMarks = marksFor(block.id, block.hidden, rules);
			return blockMarks ? compileBlock(block, inputs, fonts, blockMarks) : "";
		})
		.join("");
	return `<div data-juno-section="${escapeHtml(section.name)}" data-juno-id="${escapeHtml(section.id)}"${markAttributes(marks)}${style}>${children}</div>`;
}

/**
 * How an element is marked, or null when it is left out of the message: hidden
 * by default and shown at no breakpoint, which is Figma's eye.
 */
function marksFor(id: string, hidden: boolean, rules: BreakpointRules): Marks | null {
	if (hidden && !rules.shown.has(id)) return null;
	return { className: rules.classes.get(id) ?? null, hiddenByDefault: hidden };
}

/**
 * The body fragment for a canvas. `canvasShell` wraps this, so it emits no
 * `<html>` and no `<head>`: the fonts it links and the breakpoints' media
 * queries go in the shell's head, through `fontLinks` and `breakpointCss`.
 *
 * A frame that fills is as wide as the client showing it. One that is fixed
 * is never wider than the width it was designed at, and sits in the middle.
 */
export function compileLayout(layout: MailLayout, inputs: TemplateInput[] = []): string {
	const rules = breakpointRules(layout, inputs);
	const style = styleString([
		...(layout.widthMode === "fixed" ? [`max-width:${layout.width}px`, "margin:0 auto"] : ["width:100%"]),
		layout.minHeight > 0 ? `min-height:${layout.minHeight}px` : null,
		...fillDeclarations(layout.fill),
		layout.customCss,
	]);
	const sections = layout.sections.map((section) => compileSection(section, inputs, layout.fonts, rules)).join("");
	return `<div data-juno-canvas="1"${style}>${sections}</div>`;
}

/* ------------------------------------------------------ breakpoints, as CSS */

type BreakpointRules = {
	/** The class each element with a media query rule is given, by id. */
	classes: Map<string, string>;
	/** Elements hidden by default that some breakpoint shows. */
	shown: Set<string>;
	/** The media queries, widest first. */
	css: string;
};

/**
 * What a property goes back to when a breakpoint takes away a declaration the
 * default has. `!important` in a stylesheet is the only thing that beats an
 * inline style, so a breakpoint cannot simply leave a declaration out: it has
 * to write what the property is without it.
 */
const RESET: Record<string, string> = {
	padding: "0",
	border: "0",
	"border-top": "0",
	"border-right": "0",
	"border-bottom": "0",
	"border-left": "0",
	"border-radius": "0",
	background: "transparent",
	"background-color": "transparent",
	"background-image": "none",
	opacity: "1",
	"box-shadow": "none",
	filter: "none",
	width: "auto",
	"max-width": "none",
	"box-sizing": "content-box",
	"min-height": "0",
	overflow: "visible",
	color: "inherit",
	"font-family": "inherit",
	"font-size": "inherit",
	"line-height": "inherit",
	"letter-spacing": "normal",
	"font-weight": "inherit",
	"font-style": "normal",
	"text-decoration": "none",
	"text-transform": "none",
	"text-align": "inherit",
	display: "block",
	"flex-direction": "row",
	"justify-content": "flex-start",
	"align-items": "stretch",
	gap: "0",
	"flex-wrap": "nowrap",
	"grid-template-columns": "none",
	flex: "0 1 auto",
	"align-self": "auto",
	margin: "0",
	"margin-left": "0",
	"margin-right": "0",
};

/** A declaration list as property to value, the last of a repeated property winning as it does in CSS. */
function declarationMap(declarations: (string | null)[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of declarations) {
		if (!entry) continue;
		for (const part of entry.split(";")) {
			const colon = part.indexOf(":");
			if (colon < 0) continue;
			const property = part.slice(0, colon).trim().toLowerCase();
			const value = part.slice(colon + 1).trim();
			if (property && value) map.set(property, value);
		}
	}
	return map;
}

/**
 * The declarations a breakpoint writes for one element: what it changes from
 * what the wider widths already say, and what it takes away, as resets that
 * come first so a side's `border-top` is not undone by the `border:0` that
 * clears the rest.
 */
function ruleDeclarations(
	inherited: Map<string, string>,
	effective: Map<string, string>,
	hiddenBefore: boolean,
	hiddenHere: boolean,
	naturalDisplay: string,
): string[] {
	if (hiddenHere) return hiddenBefore ? [] : ["display:none"];
	const out: string[] = [];
	// Shown here after being hidden wider up: the display comes back whatever
	// else is the same, because what hid it was a display of its own.
	const restoring = hiddenBefore;
	for (const property of inherited.keys()) {
		if (restoring && property === "display") continue;
		if (!effective.has(property)) out.push(`${property}:${RESET[property] ?? "initial"}`);
	}
	if (restoring) out.push(`display:${effective.get("display") ?? naturalDisplay}`);
	for (const [property, value] of effective) {
		if (restoring && property === "display") continue;
		if (inherited.get(property) !== value) out.push(`${property}:${value}`);
	}
	return out;
}

/**
 * A class for an element's media query rules. Built from its id with anything
 * outside a class name's letters taken out, because an id is stored data and
 * a stylesheet is not somewhere stored data gets to write freely.
 */
function classFor(id: string): string {
	return `jb-${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48)}`;
}

/**
 * Every breakpoint's media query, and the marks the elements need for them.
 *
 * Breakpoints are applied widest first, the way `max-width` queries stack in a
 * client: at 320 pixels the rules for 480 apply as well, and the ones for 320
 * come after them and win. So each breakpoint is compared with what the wider
 * ones already made of the default, not with the default itself.
 */
function breakpointRules(layout: MailLayout, inputs: TemplateInput[]): BreakpointRules {
	const classes = new Map<string, string>();
	const shown = new Set<string>();
	const queries: string[] = [];
	let before = layout.sections;

	for (const breakpoint of widestFirst(layout.breakpoints)) {
		const here = before.map((section) => applySectionOverride(section, breakpoint));
		const rules: string[] = [];
		const add = (id: string, declarations: string[]) => {
			if (declarations.length === 0) return;
			const className = classes.get(id) ?? classFor(id);
			classes.set(id, className);
			rules.push(`.${className}{${declarations.map((declaration) => `${declaration} !important`).join(";")}}`);
		};

		here.forEach((section, sectionIndex) => {
			const was = before[sectionIndex];
			if (!was) return;
			add(
				section.id,
				ruleDeclarations(
					declarationMap(sectionDeclarations(was)),
					declarationMap(sectionDeclarations(section)),
					was.hidden,
					section.hidden,
					"block",
				),
			);
			if (!section.hidden) shown.add(section.id);
			section.blocks.forEach((block, blockIndex) => {
				const previous = was.blocks[blockIndex];
				if (!previous) return;
				add(
					block.id,
					ruleDeclarations(
						declarationMap(blockDeclarations(previous, inputs, layout.fonts)),
						declarationMap(blockDeclarations(block, inputs, layout.fonts)),
						previous.hidden,
						block.hidden,
						block.kind === "html" && codeRoot(sanitiseMarkup(block.html))?.name === "table" ? "table" : "block",
					),
				);
				if (!block.hidden) shown.add(block.id);
			});
		});

		if (rules.length > 0) queries.push(`@media only screen and (max-width:${breakpoint.maxWidth}px){${rules.join("")}}`);
		before = here;
	}

	// The default's own hidden elements are only "shown" when a breakpoint
	// showed them, not merely because they were visible before one hid them.
	for (const section of layout.sections) {
		if (!section.hidden) shown.delete(section.id);
		for (const block of section.blocks) if (!block.hidden) shown.delete(block.id);
	}

	return { classes, shown, css: queries.join("").replace(/[<>]/g, "") };
}

/**
 * The breakpoints as a stylesheet for the head of the message, or an empty
 * string when there are none. Built from the same layout, in the same order,
 * as the classes `compileLayout` writes, so the two always agree.
 */
export function breakpointCss(layout: MailLayout | null, inputs: TemplateInput[] = []): string {
	return layout ? breakpointRules(layout, inputs).css : "";
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

const BOX_PROPERTIES = [
	"background",
	"background-color",
	"background-image",
	"padding",
	"border",
	"border-top",
	"border-right",
	"border-bottom",
	"border-left",
	"border-radius",
	"opacity",
	"box-shadow",
	"filter",
	"width",
	"max-width",
	"box-sizing",
	"min-height",
	"overflow",
	"align-self",
];

/** A colour and an opacity as one colour, the opacity in the two digits after the six. */
function withAlpha(color: MailColor, opacity: number): MailColor {
	if (opacity >= 1) return color;
	return `${color}${Math.round(Math.max(opacity, 0) * 255)
		.toString(16)
		.padStart(2, "0")}`;
}

/** A colour as the compiler writes it: hex, or `rgba()` for one with an opacity. */
function readColor(value: string | undefined): MailColor | null {
	if (!value) return null;
	const hex = toColor(value);
	if (hex) return hex;
	const parsed = readColorWithAlpha(value);
	return parsed ? toColor(withAlpha(parsed.color, parsed.opacity)) : null;
}

const GRADIENT_STOP = "(#[0-9a-f]{3,8}|rgba?\\([^)]*\\))";
const GRADIENT = new RegExp(
	`^linear-gradient\\(\\s*(-?[\\d.]+)deg\\s*,\\s*${GRADIENT_STOP}\\s*,\\s*${GRADIENT_STOP}\\s*\\)$`,
	"i",
);

/** The fill, from whichever of the declarations the compiler wrote. */
function readFill(map: Declarations): MailFill | null {
	const image = (map.get("background-image") ?? "").trim();
	const gradient = GRADIENT.exec(image);
	if (gradient) {
		const from = readColor(gradient[2]);
		const to = readColor(gradient[3]);
		if (from && to) {
			const angle = Number.parseFloat(gradient[1] ?? "180");
			return { kind: "gradient", angle: Number.isFinite(angle) ? angle : 180, from, to, hidden: false };
		}
	}
	const flat = readColor(map.get("background-color") ?? map.get("background"));
	return flat ? { kind: "solid", color: flat, hidden: false } : null;
}

/** A colour that may carry an alpha, which is how a shadow was written. */
function readColorWithAlpha(value: string): { color: MailColor; opacity: number } | null {
	const hex = toColor(value);
	if (hex) return { color: hex, opacity: 1 };
	const parts = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
	if (!parts) return null;
	const channel = (raw: string): string =>
		Math.min(255, Math.max(0, Number.parseInt(raw, 10) || 0))
			.toString(16)
			.padStart(2, "0");
	const alpha = parts[4] === undefined ? 1 : Number.parseFloat(parts[4]);
	return {
		color: `#${channel(parts[1] ?? "0")}${channel(parts[2] ?? "0")}${channel(parts[3] ?? "0")}`,
		opacity: Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1,
	};
}

/** Splits a shadow list on the commas between shadows, not the ones inside an
 * `rgba()`. */
function splitShadows(value: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (const character of value) {
		if (character === "(") depth++;
		if (character === ")") depth--;
		if (character === "," && depth === 0) {
			out.push(current);
			current = "";
			continue;
		}
		current += character;
	}
	if (current.trim()) out.push(current);
	return out;
}

function readEffects(map: Declarations): MailEffect[] {
	const effects: MailEffect[] = [];
	for (const part of splitShadows(map.get("box-shadow") ?? "")) {
		const trimmed = part.trim();
		const inset = /^inset\s+/i.test(trimmed);
		const shadow = /^(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/.exec(
			trimmed.replace(/^inset\s+/i, ""),
		);
		if (!shadow) continue;
		const colour = readColorWithAlpha(shadow[5] ?? "");
		if (!colour) continue;
		effects.push({
			kind: "shadow",
			inset,
			x: Number.parseFloat(shadow[1] ?? "0"),
			y: Number.parseFloat(shadow[2] ?? "0"),
			blur: Number.parseFloat(shadow[3] ?? "0"),
			spread: Number.parseFloat(shadow[4] ?? "0"),
			color: colour.color.slice(0, 7),
			opacity: colour.opacity * alphaOf(colour.color),
			hidden: false,
		});
	}
	const blur = /blur\(\s*([\d.]+)px\s*\)/i.exec(map.get("filter") ?? "");
	if (blur) effects.push({ kind: "blur", radius: Number.parseFloat(blur[1] ?? "0"), hidden: false });
	return effects.slice(0, MAX_EFFECTS);
}

function readCorners(map: Declarations): { borderRadius: number; corners: MailCorners | null } {
	const value = map.get("border-radius");
	if (!value) return { borderRadius: 0, corners: null };
	const parts = value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
	if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
		return { borderRadius: 0, corners: null };
	}
	const [a = 0, b = a, c = a, d = b] = parts;
	if (parts.length === 1) return { borderRadius: a, corners: null };
	return { borderRadius: a, corners: { topLeft: a, topRight: b, bottomRight: c, bottomLeft: d } };
}

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

type Stroke = { width: number; color: MailColor | null; style: MailStrokeStyle; sides: MailSides };

const STROKE = /^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted)\s+(.+)$/i;

/**
 * The stroke, from one `border` or from the sides it is drawn on. `sides` is
 * off for a divider, whose `border-top` is the rule itself rather than a
 * stroke round a box.
 */
function readStroke(map: Declarations, sides: boolean): Stroke {
	const none: Stroke = { width: 0, color: null, style: "solid", sides: allSides() };
	const all = STROKE.exec((map.get("border") ?? "").trim());
	if (all && readColor(all[3])) {
		return {
			width: Number.parseFloat(all[1] ?? "0"),
			color: readColor(all[3]),
			style: toStrokeStyle((all[2] ?? "solid").toLowerCase()),
			sides: allSides(),
		};
	}
	if (!sides) return none;
	const found = SIDES.map((side) => ({ side, match: STROKE.exec((map.get(`border-${side}`) ?? "").trim()) })).filter(
		(entry) => entry.match !== null && readColor(entry.match[3]) !== null,
	);
	const first = found[0]?.match;
	if (!first) return none;
	return {
		width: Number.parseFloat(first[1] ?? "0"),
		color: readColor(first[3]),
		style: toStrokeStyle((first[2] ?? "solid").toLowerCase()),
		sides: {
			top: found.some((entry) => entry.side === "top"),
			right: found.some((entry) => entry.side === "right"),
			bottom: found.some((entry) => entry.side === "bottom"),
			left: found.some((entry) => entry.side === "left"),
		},
	};
}

function readBox(map: Declarations, extraOwned: string[] = [], sides = true): MailBoxStyle {
	const stroke = readStroke(map, sides);
	const opacity = Number.parseFloat(map.get("opacity") ?? "");
	const radius = readCorners(map);
	return {
		fill: readFill(map),
		padding: readPadding(map),
		borderWidth: stroke.width,
		borderColor: stroke.color,
		borderStyle: stroke.style,
		borderSides: stroke.sides,
		strokeHidden: false,
		borderRadius: radius.borderRadius,
		corners: radius.corners,
		opacity: Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : 1,
		effects: readEffects(map),
		// Pixels only: a divider's `width:100%` is its own, not a fixed width.
		width: /^\d+(?:\.\d+)?px$/.test(map.get("width") ?? "") ? px(map, "width") : null,
		minHeight: px(map, "min-height"),
		clip: map.get("overflow") === "hidden",
		customCss: leftoverCss(map, [...BOX_PROPERTIES, ...extraOwned]),
	};
}

const TEXT_PROPERTIES = [
	"color",
	"font-family",
	"font-size",
	"line-height",
	"letter-spacing",
	"font-weight",
	"font-style",
	"text-decoration",
	"text-transform",
	"text-align",
	"margin",
];

/** The three declarations vertical alignment writes, owned only when they are that. */
function verticalOwned(map: Declarations): string[] {
	return map.get("display") === "flex" && map.get("flex-direction") === "column"
		? ["display", "flex-direction", "justify-content"]
		: [];
}

/** The family a `font-family` names first, as the panel knows it. */
function readFamily(value: string | undefined): string | null {
	if (!value) return null;
	const first = (value.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
	return toFamily(first);
}

function readTextStyle(map: Declarations): MailTextStyle {
	const weightValue = map.get("font-weight") ?? "";
	const numeric = weightValue === "bold" ? 700 : weightValue === "normal" ? 400 : Number.parseInt(weightValue, 10);
	const weight = (Object.keys(FONT_WEIGHTS) as MailWeight[]).find((name) => FONT_WEIGHTS[name] === numeric) ?? "normal";
	const decoration = map.get("text-decoration") ?? "";
	const textCase = map.get("text-transform");
	const justify = verticalOwned(map).length > 0 ? map.get("justify-content") : undefined;
	const lineHeight = Number.parseFloat(map.get("line-height") ?? "");
	return {
		color: readColor(map.get("color")),
		fontFamily: readFamily(map.get("font-family")),
		fontSize: px(map, "font-size"),
		lineHeight: Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : null,
		letterSpacing: px(map, "letter-spacing"),
		weight,
		italic: map.get("font-style") === "italic",
		decoration: /underline/.test(decoration) ? "underline" : /line-through/.test(decoration) ? "strike" : "none",
		transform:
			textCase === "uppercase" ? "upper" : textCase === "lowercase" ? "lower" : textCase === "capitalize" ? "title" : "none",
		align: toAlignText(map.get("text-align")),
		verticalAlign: justify === "center" ? "middle" : justify === "flex-end" ? "bottom" : "top",
	};
}

function readSelfAlign(value: string | undefined): MailSelfAlign {
	switch (value) {
		case "flex-start":
		case "start":
			return "start";
		case "center":
			return "center";
		case "flex-end":
		case "end":
			return "end";
		case "stretch":
			return "stretch";
		default:
			return "auto";
	}
}

/** The content inside the span vertical alignment wraps it in, or the content as it is. */
function unwrapVertical(inner: string): string {
	const wrapped = /^<span data-juno-inner="1"[^>]*>([\s\S]*)<\/span>$/.exec(inner.trim());
	return wrapped ? (wrapped[1] ?? "") : inner;
}

function readGrow(map: Declarations): number {
	const flex = map.get("flex");
	if (!flex) return 0;
	const parsed = Number.parseFloat(flex);
	return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 12) : 0;
}

function rawBlock(html: string): MailBlock {
	return {
		id: randomUUID(),
		kind: "html",
		html: sanitiseMarkup(html),
		css: "",
		grow: 0,
		alignSelf: "auto",
		hidden: false,
	};
}

/** An element's markup without the compiler's markers, its breakpoint class and its style, which is the CSS. */
function bareElement(node: Extract<Node, { type: "element" }>): string {
	const attrs = node.attrs
		.replace(/\s+data-juno-[a-z-]+="[^"]*"/g, "")
		.replace(/\s+class="jb-[A-Za-z0-9_-]*"/g, "")
		.replace(/\s+style\s*=\s*"[^"]*"/i, "");
	return VOID_TAGS.has(node.name) ? `<${node.name}${attrs}>` : `<${node.name}${attrs}>${node.inner}</${node.name}>`;
}

/**
 * Whether the compiler wrote an element as hidden by default and shown at a
 * breakpoint, and its attributes without the two declarations that say so.
 * They are always the last two, so they cannot be mistaken for the author's.
 */
function withoutHiddenMarks(attrs: string): { attrs: string; hidden: boolean } {
	const match = /(\sstyle="[^"]*?);?display:none;mso-hide:all"/i.exec(attrs);
	if (!match) return { attrs, hidden: false };
	return { attrs: attrs.replace(match[0], `${match[1]}"`), hidden: true };
}

function readBlock(node: Extract<Node, { type: "element" }>): MailBlock {
	const kind = attribute(node.attrs, "data-juno-block");
	const marks = withoutHiddenMarks(node.attrs);
	const map = readStyle(marks.attrs);
	const common = {
		id: attribute(node.attrs, "data-juno-id") ?? randomUUID(),
		grow: readGrow(map),
		alignSelf: readSelfAlign(map.get("align-self")),
		hidden: marks.hidden,
	};
	const textOwned = [...TEXT_PROPERTIES, ...verticalOwned(map), "flex"];

	switch (kind) {
		case "heading": {
			const level = node.name === "h1" ? 1 : node.name === "h3" ? 3 : 2;
			return {
				...common,
				kind: "heading",
				level,
				content: unescapeAttr(unwrapVertical(node.inner).replace(/<[^>]+>/g, "")),
				text: readTextStyle(map),
				box: readBox(map, textOwned),
			};
		}
		case "text":
			return {
				...common,
				kind: "text",
				html: sanitiseFragment(unwrapVertical(node.inner)),
				text: readTextStyle(map),
				box: readBox(map, textOwned),
			};
		case "button": {
			const box = readBox(map, [...textOwned, "display", "text-decoration", "background"]);
			const padding = box.padding;
			const defaultPadding = padding.top === 10 && padding.right === 18 && padding.bottom === 10 && padding.left === 18;
			return {
				...common,
				kind: "button",
				label: unescapeAttr(node.inner.replace(/<[^>]+>/g, "")),
				href: safeHref(unescapeAttr(attribute(node.attrs, "href") ?? "")) ?? "",
				background: readColor(map.get("background")) ?? "#4a3fa0",
				color: readColor(map.get("color")) ?? "#ffffff",
				radius: box.borderRadius || 4,
				// The label colour is the button's own, so the text style carries none.
				text: { ...readTextStyle(map), color: null },
				box: {
					...box,
					fill: null,
					borderRadius: 0,
					// The padding a button gets when it has none is written out, so
					// reading it back as the author's own would pin it.
					padding: defaultPadding ? { top: 10, right: 18, bottom: 10, left: 18 } : padding,
				},
			};
		}
		case "image":
			return {
				...common,
				kind: "image",
				src: safeImageSrc(unescapeAttr(attribute(node.attrs, "src") ?? "")) ?? "",
				alt: unescapeAttr(attribute(node.attrs, "alt") ?? ""),
				width: px(map, "width"),
				align: map.get("margin") === "0 auto" ? "center" : map.get("margin-left") === "auto" ? "right" : "left",
				box: {
					...readBox(map, ["display", "max-width", "width", "height", "margin", "margin-left", "flex"]),
					width: null,
				},
			};
		case "divider": {
			const top = map.get("border-top") ?? "";
			const dividerMatch = /^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/i.exec(top.trim());
			return {
				...common,
				kind: "divider",
				color: (dividerMatch ? readColor(dividerMatch[2]) : null) ?? "#e3e2ec",
				thickness: dividerMatch ? Number.parseFloat(dividerMatch[1] ?? "1") : 1,
				box: readBox(map, ["border-top", "flex"], false),
			};
		}
		case "spacer":
			return { ...common, kind: "spacer", height: px(map, "height") ?? 16 };
		case "field": {
			const inputKey = attribute(node.attrs, "data-juno-field") ?? "";
			return {
				...common,
				kind: "field",
				inputKey: unescapeAttr(inputKey),
				text: readTextStyle(map),
				box: readBox(map, [...textOwned, "display", "height"]),
			};
		}
		case "html": {
			// The CSS is what the style says, bar the flex and alignment that
			// `common` has already read into the block's own placement.
			const css = leftoverCss(map, ["flex", "align-self"]) ?? "";
			const wrapped = attribute(node.attrs, "data-juno-wrap") !== null;
			return {
				...common,
				kind: "html",
				html: sanitiseMarkup(wrapped ? node.inner : bareElement(node)),
				css,
			};
		}
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
	const marks = withoutHiddenMarks(node.attrs);
	const map = readStyle(marks.attrs);
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

	const left = map.get("margin-left") === "auto";
	const right = map.get("margin-right") === "auto";
	return {
		id: attribute(node.attrs, "data-juno-id") ?? randomUUID(),
		name: unescapeAttr(attribute(node.attrs, "data-juno-section") || "Section"),
		// A section hidden everywhere is never compiled. One that is here was
		// showing, or was hidden by default for a breakpoint to show.
		hidden: marks.hidden,
		alignSelf: left && right ? "center" : left ? "end" : "auto",
		layout: readSectionLayout(map),
		box: readBox(map, [...SECTION_PROPERTIES, "flex", "margin-left", "margin-right"]),
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
		// which the author can then break up on the canvas. It gets the room the
		// house frame used to give a hand-written body, so moving it onto a
		// canvas, which sends it without that frame, does not push the words
		// against the edge of the message.
		const section = emptySection("Body");
		section.box = { ...section.box, padding: { top: 32, right: 36, bottom: 32, left: 36 } };
		section.blocks = html.trim() ? [rawBlock(html)] : [];
		return { ...base, sections: [section], breakpoints: parseBreakpoints(base.breakpoints, [section]) };
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

	const kept = sections.length > 0 ? sections : [emptySection("Body")];
	const maxWidth = px(map, "max-width");
	return {
		version: 1,
		// A frame that fills writes no width of its own, so the width it is
		// drawn at comes from the canvas the markup came from.
		width: maxWidth ?? base.width,
		widthMode: maxWidth !== null ? "fixed" : "fill",
		minHeight: px(map, "min-height") ?? 0,
		fill: readFill(map),
		// Fonts and breakpoints live in the head of the message, not in this
		// fragment, so the canvas the markup came from is the only place to
		// find them. A breakpoint keeps what it changes about the sections and
		// blocks that are still there.
		fonts: base.fonts,
		customCss: leftoverCss(map, [
			"max-width",
			"width",
			"margin",
			"min-height",
			"background",
			"background-color",
			"background-image",
		]),
		sections: kept,
		breakpoints: parseBreakpoints(base.breakpoints, kept),
	};
}

/* ------------------------------------------------------------ convert to code */

/**
 * A block as the HTML and CSS it compiles to: the element, and its style as
 * declarations. Compiling the result gives the same markup back, which is
 * what makes "Convert to HTML" a change of how a block is edited rather than
 * of what it looks like.
 */
export function blockToCode(block: MailBlock, inputs: TemplateInput[], fonts: MailFont[]): { html: string; css: string } {
	if (block.kind === "html") return { html: block.html, css: block.css };
	// Compiled as showing, whatever the eye says: a hidden block converts to
	// the code it would be if it were shown, and stays hidden.
	const compiled = compileBlock({ ...block, hidden: false }, inputs, fonts);
	const node = splitTopLevel(compiled).find(
		(entry): entry is Extract<Node, { type: "element" }> => entry.type === "element",
	);
	if (!node) return { html: sanitiseMarkup(compiled), css: "" };
	return {
		html: sanitiseMarkup(bareElement(node)),
		css: sanitiseDeclarations(unescapeAttr(attribute(node.attrs, "style") ?? "")),
	};
}

/**
 * Replaces one block with the code it compiles to. The placement it had is
 * part of that code now, so the new block carries none of its own.
 */
export function convertBlockToCode(
	layout: MailLayout,
	sectionId: string,
	blockId: string,
	inputs: TemplateInput[],
): MailLayout {
	return {
		...layout,
		sections: layout.sections.map((section) =>
			section.id !== sectionId
				? section
				: {
						...section,
						blocks: section.blocks.map((block) => {
							if (block.id !== blockId || block.kind === "html") return block;
							const code = blockToCode(block, inputs, layout.fonts);
							return {
								id: block.id,
								kind: "html",
								html: code.html,
								css: code.css,
								grow: 0,
								alignSelf: "auto",
								hidden: block.hidden,
							};
						}),
					},
		),
		// What a breakpoint changed about the block was its style, which is code
		// now. Whether it shows at a breakpoint is still the block's own.
		breakpoints: layout.breakpoints.map((breakpoint) => {
			const override = entryOf(breakpoint.blocks, blockId) as MailBlockOverride | undefined;
			if (!override) return breakpoint;
			const blocks = Object.fromEntries(Object.entries(breakpoint.blocks).filter(([id]) => id !== blockId));
			if (override.hidden !== undefined) blocks[blockId] = { hidden: override.hidden };
			return { ...breakpoint, blocks };
		}),
	};
}
