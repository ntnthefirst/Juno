import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nativePalette } from "./native-palette";

const tokens = readFileSync(join(__dirname, "..", "..", "..", "src", "styles", "tokens.css"), "utf8");

/** The value of a custom property inside the first block that opens with `selector {`. */
function token(selector: string, name: string): string {
	const start = tokens.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`tokens.css has no block for ${selector}`);
	const block = tokens.slice(start, tokens.indexOf("}", start));
	const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
	if (!match) throw new Error(`${selector} sets no ${name}`);
	return match[1]!.trim().toLowerCase();
}

describe("native palette", () => {
	it("matches --paper and --ink-muted in the light theme", () => {
		expect(nativePalette(false)).toEqual({
			paper: token(":root", "--paper"),
			symbol: token(":root", "--ink-muted"),
		});
	});

	it("matches --paper and --ink-muted in the dark theme", () => {
		expect(nativePalette(true)).toEqual({
			paper: token(':root[data-theme="dark"]', "--paper"),
			symbol: token(':root[data-theme="dark"]', "--ink-muted"),
		});
	});
});
