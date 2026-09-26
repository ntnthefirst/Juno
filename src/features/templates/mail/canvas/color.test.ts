import { describe, expect, it } from "vitest";
import { hexDigits, hsvToRgb, opacityPercent, parseHex, rgbToHsv, toHex, withDigits, withOpacity } from "./color";

describe("colour for the picker", () => {
	it("reads three, six and eight digits, and nothing else", () => {
		expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
		expect(parseHex("#4a3fa080")?.a).toBeCloseTo(0.502, 3);
		expect(parseHex("red")).toBeNull();
		expect(parseHex("#4a3fa")).toBeNull();
	});

	it("writes six digits for a solid colour and eight for one with an opacity", () => {
		expect(toHex({ r: 74, g: 63, b: 160, a: 1 })).toBe("#4a3fa0");
		expect(toHex({ r: 74, g: 63, b: 160, a: 0.5 })).toBe("#4a3fa080");
	});

	it("goes round hue, saturation and brightness and back to the same colour", () => {
		for (const color of ["#4a3fa0", "#e3e2ec", "#16161d", "#ff0000", "#00ff80", "#ffffff", "#000000"]) {
			const parsed = parseHex(color);
			if (!parsed) throw new Error(color);
			expect(toHex(hsvToRgb(rgbToHsv(parsed)))).toBe(color);
		}
	});

	it("shows the hex and the percentage the way Figma does", () => {
		expect(hexDigits("#4a3fa080")).toBe("4A3FA0");
		expect(opacityPercent("#4a3fa080")).toBe(50);
		expect(opacityPercent("#4a3fa0")).toBe(100);
	});

	it("changes the opacity without touching the colour, and the colour without touching the opacity", () => {
		expect(withOpacity("#4a3fa0", 50)).toBe("#4a3fa080");
		expect(withOpacity("#4a3fa080", 100)).toBe("#4a3fa0");
		expect(withDigits("#4a3fa080", "16161D")).toBe("#16161d80");
		expect(withDigits("#4a3fa0", "#fff")).toBe("#ffffff");
		expect(withDigits("#4a3fa0", "nope")).toBeNull();
	});
});
