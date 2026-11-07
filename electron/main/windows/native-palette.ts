/**
 * The two colours the operating system paints with, in each theme: the window
 * background behind the page, and the caption-button glyphs over the title bar.
 *
 * They are --paper and --ink-muted from tokens.css, written out because a
 * native surface cannot read a stylesheet. `native-palette.test.ts` reads
 * tokens.css and fails when the two disagree, which is the only thing that
 * keeps a close button from sitting on a slightly different grey than the bar
 * it is drawn over. splash.ts carries the same values for its own document.
 *
 * Kept free of `electron` so the test can load it in plain Node.
 */
export interface NativePalette {
	/** --paper: the window background and the caption-button background. */
	paper: string;
	/** --ink-muted: the caption-button glyphs. */
	symbol: string;
}

const LIGHT: NativePalette = { paper: "#f1f1f4", symbol: "#4d4e58" };
const DARK: NativePalette = { paper: "#0d0d10", symbol: "#b1b2bc" };

export function nativePalette(dark: boolean): NativePalette {
	return dark ? DARK : LIGHT;
}
