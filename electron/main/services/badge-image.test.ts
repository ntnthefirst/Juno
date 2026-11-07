import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BADGE_SIZE, badgeLabel, badgePixels, badgePng } from "./badge-image";

describe("badgeLabel", () => {
	it("says the number, and 9+ once it stops fitting", () => {
		expect(badgeLabel(1)).toBe("1");
		expect(badgeLabel(9)).toBe("9");
		expect(badgeLabel(10)).toBe("9+");
		expect(badgeLabel(250)).toBe("9+");
	});
});

describe("badge picture", () => {
	it("draws a circle with the label in white", () => {
		const pixels = badgePixels(3);
		const at = (x: number, y: number) => (y * BADGE_SIZE + x) * 4;
		expect(pixels[at(0, 0) + 3]).toBe(0);
		expect(pixels[at(2, 16) + 3]).toBe(255);
		const white = [...Array(BADGE_SIZE * BADGE_SIZE).keys()].filter((i) => pixels[i * 4] === 255).length;
		expect(white).toBeGreaterThan(20);
	});

	it("draws a different picture for a different number", () => {
		expect(Buffer.from(badgePixels(1)).equals(Buffer.from(badgePixels(2)))).toBe(false);
	});

	it("is a PNG whose pixels read back as drawn", () => {
		const png = badgePng(4);
		expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
		const start = png.indexOf("IDAT") + 4;
		const length = png.readUInt32BE(png.indexOf("IDAT") - 4);
		const raw = inflateSync(png.subarray(start, start + length));
		expect(raw.length).toBe((BADGE_SIZE * 4 + 1) * BADGE_SIZE);
	});
});
