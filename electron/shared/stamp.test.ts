import { describe, expect, it } from "vitest";
import { STAMP_MAX_WIDTH, STAMP_MIN_WIDTH, clampPlacement, stampMetrics } from "./stamp";

describe("stamp geometry", () => {
	it("scales every measure with the width", () => {
		const small = stampMetrics(100, 0.4);
		const large = stampMetrics(300, 0.4);
		expect(large.height).toBeCloseTo(small.height * 3, 6);
		expect(large.nameSize).toBeCloseTo(small.nameSize * 3, 6);
	});

	it("is shorter without an image", () => {
		expect(stampMetrics(200, null).height).toBeLessThan(stampMetrics(200, 0.4).height);
	});

	it("never lets a tall image take more than half the width", () => {
		expect(stampMetrics(200, 5).imageHeight).toBe(100);
	});

	it("keeps the stamp on the page and inside the size limits", () => {
		const placed = clampPlacement({ x: 2, y: 2, width: 5 }, 0.4, 1.414);
		expect(placed.width).toBe(STAMP_MAX_WIDTH);
		expect(placed.x).toBeCloseTo(1 - STAMP_MAX_WIDTH, 6);
		expect(placed.y).toBeLessThan(1);
		expect(clampPlacement({ x: -1, y: -1, width: 0 }, null, 1.414)).toMatchObject({
			x: 0,
			y: 0,
			width: STAMP_MIN_WIDTH,
		});
	});
});
