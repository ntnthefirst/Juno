/**
 * The declarations the compiler emits, as React style objects.
 *
 * This mirrors electron/main/services/mail-layout.ts rather than calling it,
 * because the renderer cannot import from electron/main (architecture.md
 * section 7). The copy is deliberate and bounded: the canvas is an editing
 * surface, and the preview beside it is rendered by the real compiler, so
 * anything that drifts here shows up as a canvas that disagrees with the
 * preview rather than as output nobody checked.
 *
 * Nothing in here places anything. There is no position, no coordinate and no
 * float, and the banned list below keeps hand-written CSS from putting one
 * back while it is still a draft, the same way `sanitiseDeclarations` does on
 * the way into the database.
 */
import type { CSSProperties } from "react";
import type {
	MailBlock,
	MailBoxStyle,
	MailEffect,
	MailFill,
	MailFont,
	MailFontFallback,
	MailSection,
	MailTextStyle,
	MailWeight,
} from "@shared/types";

/**
 * What the message itself is set in, from the shell in
 * services/mail-html.ts.
 *
 * The canvas has to carry it or a block with no colour of its own inherits the
 * application's ink, which is near-white in dark mode and therefore invisible
 * on the paper the frame is drawn in. A preview that is unreadable in one
 * theme is a preview that is wrong in both.
 */
export const MAIL_SHELL = {
	fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
	fontSize: 15,
	lineHeight: 1.65,
} as const;

/** Matches SYSTEM_FONTS in services/mail-layout.ts: the families every client has. */
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

/** The names a designer reads a weight by, in the order a picker lists them. */
export const WEIGHT_LABELS: Record<MailWeight, string> = {
	thin: "Thin",
	extralight: "Extra light",
	light: "Light",
	normal: "Regular",
	medium: "Medium",
	semibold: "Semibold",
	bold: "Bold",
	extrabold: "Extra bold",
	black: "Black",
};

/** Matches fontStack in services/mail-layout.ts. */
export function fontStack(family: string, fonts: MailFont[]): string {
	const system = SYSTEM_FONTS[family];
	if (system) return system;
	const linked = fonts.find((font) => font.family === family);
	return `'${family}', ${FALLBACK_STACKS[linked?.fallback ?? "sans"]}`;
}

/** Matches BANNED_PROPERTIES in services/mail-layout.ts. */
const BANNED = new Set([
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

function rgba(color: string, opacity: number): string {
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
	return `rgba(${r},${g},${b},${Number(opacity.toFixed(3))})`;
}

/** A gradient keeps its first stop as a flat colour underneath, exactly as the
 * compiled message does, so the canvas shows what a client without gradients
 * will fall back to. */
export function fillCss(fill: MailFill | null): CSSProperties {
	if (!fill) return {};
	if (fill.kind === "solid") return { backgroundColor: fill.color };
	return {
		backgroundColor: fill.from,
		backgroundImage: `linear-gradient(${fill.angle}deg,${fill.from},${fill.to})`,
	};
}

export function effectLabel(effect: MailEffect): string {
	if (effect.kind === "blur") return "Layer blur";
	return effect.inset ? "Inner shadow" : "Drop shadow";
}

function effectsCss(effects: MailEffect[]): CSSProperties {
	const shadows = effects
		.filter((effect): effect is Extract<MailEffect, { kind: "shadow" }> => effect.kind === "shadow")
		.map(
			(effect) =>
				`${effect.inset ? "inset " : ""}${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${rgba(effect.color, effect.opacity)}`,
		);
	const blur = effects.reduce((total, effect) => (effect.kind === "blur" ? total + effect.radius : total), 0);
	return {
		boxShadow: shadows.length > 0 ? shadows.join(",") : undefined,
		filter: blur > 0 ? `blur(${blur}px)` : undefined,
	};
}

/** A declaration list typed by hand, as the pairs the banned list lets through. */
function declarationPairs(css: string | null): [string, string][] {
	if (!css) return [];
	const pairs: [string, string][] = [];
	for (const part of css.split(";")) {
		const colon = part.indexOf(":");
		if (colon < 0) continue;
		const property = part.slice(0, colon).trim().toLowerCase();
		const value = part.slice(colon + 1).trim();
		if (!property || !value) continue;
		if (!/^-?[a-z][a-z0-9-]*$/.test(property)) continue;
		if (BANNED.has(property)) continue;
		if (/["<>]/.test(value) || /expression\s*\(|javascript:/i.test(value)) continue;
		pairs.push([property, value]);
	}
	return pairs;
}

function camel(property: string): string {
	return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * A declaration list typed by hand, as a style object.
 *
 * Written out rather than left to the compiler so the canvas shows what the
 * message will, and filtered through the same banned list so a draft cannot
 * do what a saved template is not allowed to do.
 */
function customCss(css: string | null): CSSProperties {
	return Object.fromEntries(declarationPairs(css).map(([property, value]) => [camel(property), value])) as CSSProperties;
}

/** The same list as a string, for a style attribute written into markup. */
export function cleanDeclarations(css: string | null): string {
	return declarationPairs(css)
		.map(([property, value]) => `${property}:${value}`)
		.join(";");
}

const PLACEMENT = new Set([
	"flex",
	"flex-grow",
	"flex-shrink",
	"flex-basis",
	"align-self",
	"order",
	"width",
	"min-width",
	"max-width",
]);

/**
 * The part of a code block's CSS that places and sizes it in its section.
 *
 * Every other block is drawn as the element the message carries, so it is the
 * flex item itself. A code block cannot be: its markup is set as HTML inside
 * an element the canvas owns, so these go on that element, where they have
 * the effect they have in the message and the selection outline is drawn
 * round the size the code asks for.
 */
export function placementFromCss(css: string): CSSProperties {
	return Object.fromEntries(
		declarationPairs(css)
			.filter(([property]) => PLACEMENT.has(property))
			.map(([property, value]) => [camel(property), value]),
	) as CSSProperties;
}

function radiusCss(box: MailBoxStyle): string | undefined {
	const corners = box.corners;
	if (!corners) return box.borderRadius > 0 ? `${box.borderRadius}px` : undefined;
	return `${corners.topLeft}px ${corners.topRight}px ${corners.bottomRight}px ${corners.bottomLeft}px`;
}

export function boxCss(box: MailBoxStyle): CSSProperties {
	return {
		...fillCss(box.fill),
		padding: `${box.padding.top}px ${box.padding.right}px ${box.padding.bottom}px ${box.padding.left}px`,
		border:
			box.borderWidth > 0
				? `${box.borderWidth}px ${box.borderStyle} ${box.borderColor ?? "#e3e2ec"}`
				: undefined,
		borderRadius: radiusCss(box),
		opacity: box.opacity < 1 ? box.opacity : undefined,
		...effectsCss(box.effects),
		width: box.width ?? undefined,
		maxWidth: box.width !== null ? "100%" : undefined,
		boxSizing: box.width !== null ? "border-box" : undefined,
		minHeight: box.minHeight ?? undefined,
		overflow: box.clip ? "hidden" : undefined,
		// Last, so a hand-written declaration wins over the controls above it.
		...customCss(box.customCss),
	};
}

const CASE: Record<MailTextStyle["transform"], CSSProperties["textTransform"]> = {
	none: undefined,
	upper: "uppercase",
	lower: "lowercase",
	title: "capitalize",
};

type TextCssOptions = { alwaysWeight?: boolean; skipColor?: boolean };

export function textCss(text: MailTextStyle, fonts: MailFont[], options: TextCssOptions = {}): CSSProperties {
	const weight = FONT_WEIGHTS[text.weight];
	return {
		color: options.skipColor ? undefined : (text.color ?? undefined),
		fontFamily: text.fontFamily ? fontStack(text.fontFamily, fonts) : undefined,
		fontSize: text.fontSize ?? undefined,
		lineHeight: text.lineHeight ?? undefined,
		letterSpacing: text.letterSpacing !== null ? `${text.letterSpacing}px` : undefined,
		fontWeight: weight !== 400 || options.alwaysWeight ? weight : undefined,
		fontStyle: text.italic ? "italic" : undefined,
		textDecoration:
			text.decoration === "underline" ? "underline" : text.decoration === "strike" ? "line-through" : undefined,
		textTransform: CASE[text.transform],
		textAlign: text.align,
	};
}

/** Matches verticalDeclarations: a column that pushes one inner span up or down. */
export function verticalCss(text: MailTextStyle): CSSProperties {
	if (text.verticalAlign === "top") return {};
	return {
		display: "flex",
		flexDirection: "column",
		justifyContent: text.verticalAlign === "middle" ? "center" : "flex-end",
	};
}

const SELF: Record<MailBlock["alignSelf"], CSSProperties["alignSelf"]> = {
	auto: undefined,
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
};

/** How a block takes its place in its section: its share of the room, and where it sits across. */
export function placeCss(block: MailBlock): CSSProperties {
	return {
		flex: block.grow > 0 ? `${block.grow} 1 0%` : undefined,
		alignSelf: SELF[block.alignSelf],
	};
}

export function sectionCss(section: MailSection): CSSProperties {
	const box = boxCss(section.box);
	if (section.layout.kind === "grid") {
		return {
			...box,
			display: "grid",
			gridTemplateColumns: `repeat(${section.layout.columns},1fr)`,
			gap: section.layout.gap,
			alignItems: section.layout.align === "stretch" ? "stretch" : section.layout.align,
		};
	}
	const justify = {
		start: "flex-start",
		center: "center",
		end: "flex-end",
		between: "space-between",
		around: "space-around",
	}[section.layout.justify];
	return {
		...box,
		display: "flex",
		flexDirection: section.layout.direction,
		justifyContent: justify,
		alignItems: section.layout.align === "stretch" ? "stretch" : section.layout.align,
		gap: section.layout.gap,
		flexWrap: section.layout.wrap ? "wrap" : "nowrap",
	};
}
