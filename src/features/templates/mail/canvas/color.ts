/**
 * Colour arithmetic for the picker: hex in and out, hue, saturation and
 * brightness for the square and the slider, and the opacity that rides in the
 * last two hex digits (electron/shared/types.ts, MailColor).
 *
 * Everything here is numbers. A colour leaves this module as `#rrggbb` or
 * `#rrggbbaa` and nothing else, which is the only shape the compiler takes.
 */

/** Red, green and blue from 0 to 255, and the opacity from 0 to 1. */
export type Rgba = { r: number; g: number; b: number; a: number };

/** Hue from 0 to 360, saturation and brightness from 0 to 1, and the opacity. */
export type Hsva = { h: number; s: number; v: number; a: number };

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function byte(value: number): string {
	return Math.round(clamp(value, 0, 255))
		.toString(16)
		.padStart(2, "0");
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa`, or null for anything else. */
export function parseHex(color: string): Rgba | null {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
	if (!match) return null;
	const raw = match[1] ?? "";
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((part) => part + part)
					.join("")
			: raw;
	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16),
		a: full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1,
	};
}

/** A colour as the model writes it: six digits when it is solid, eight when it is not. */
export function toHex({ r, g, b, a }: Rgba): string {
	const solid = `#${byte(r)}${byte(g)}${byte(b)}`;
	const alpha = Math.round(clamp(a, 0, 1) * 255);
	return alpha >= 255 ? solid : `${solid}${byte(alpha)}`;
}

export function rgbToHsv({ r, g, b, a }: Rgba): Hsva {
	const red = r / 255;
	const green = g / 255;
	const blue = b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const range = max - min;
	let h = 0;
	if (range > 0) {
		if (max === red) h = ((green - blue) / range) % 6;
		else if (max === green) h = (blue - red) / range + 2;
		else h = (red - green) / range + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : range / max, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
	const chroma = v * s;
	const part = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
	const base = v - chroma;
	const sector = Math.floor((((h % 360) + 360) % 360) / 60);
	const [red, green, blue] =
		sector === 0
			? [chroma, part, 0]
			: sector === 1
				? [part, chroma, 0]
				: sector === 2
					? [0, chroma, part]
					: sector === 3
						? [0, part, chroma]
						: sector === 4
							? [part, 0, chroma]
							: [chroma, 0, part];
	return { r: (red + base) * 255, g: (green + base) * 255, b: (blue + base) * 255, a };
}

/** The six digits Figma shows beside a swatch, upper case and without the hash. */
export function hexDigits(color: string): string {
	const parsed = parseHex(color);
	return parsed ? toHex({ ...parsed, a: 1 }).slice(1).toUpperCase() : "";
}

/** The opacity Figma shows beside the hex, as a whole percentage. */
export function opacityPercent(color: string): number {
	return Math.round((parseHex(color)?.a ?? 1) * 100);
}

/** The same colour at another opacity. */
export function withOpacity(color: string, percent: number): string {
	const parsed = parseHex(color);
	return parsed ? toHex({ ...parsed, a: clamp(percent, 0, 100) / 100 }) : color;
}

/**
 * Six digits typed over a colour, keeping the colour's opacity: typing a new
 * hex does not make a see-through fill solid. Null when what was typed is not
 * a colour.
 */
export function withDigits(color: string, typed: string): string | null {
	const digits = typed.trim().replace(/^#/, "");
	const next = parseHex(digits);
	if (!next) return null;
	// Eight digits bring an opacity of their own; three or six keep the one the colour had.
	const a = digits.length === 8 ? next.a : (parseHex(color)?.a ?? 1);
	return toHex({ ...next, a });
}

/*
 * What the picker paints its square and sliders with. These are colours in
 * the sense of the thing being picked, not the interface's: the spectrum is
 * every hue there is, and it has no token because it cannot follow a theme.
 */

/** Every hue, left to right, for the hue slider. */
export const HUE_SPECTRUM = `linear-gradient(to right, ${Array.from({ length: 7 }, (_, index) => `hsl(${index * 60} 100% 50%)`).join(", ")})`;

/** The saturation and brightness square for one hue: white to the hue across, black up from the bottom. */
export function squareBackground(hue: number): string {
	return `linear-gradient(to top, rgb(0 0 0), rgb(0 0 0 / 0)), linear-gradient(to right, rgb(255 255 255), hsl(${Math.round(hue)} 100% 50%))`;
}

/** The opacity slider for one colour: see-through on the left, solid on the right. */
export function opacityBackground(color: string): string {
	const parsed = parseHex(color) ?? { r: 0, g: 0, b: 0, a: 1 };
	return `linear-gradient(to right, rgb(${parsed.r} ${parsed.g} ${parsed.b} / 0), rgb(${parsed.r} ${parsed.g} ${parsed.b}))`;
}
