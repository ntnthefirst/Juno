import { describe, expect, it } from "vitest";
import {
	canZoomIn,
	canZoomOut,
	FIT,
	MAX_ZOOM,
	MIN_ZOOM,
	scaleOf,
	zoomByWheel,
	zoomCommandFor,
	zoomIn,
	zoomLabel,
	zoomOut,
	type Zoom,
} from "./preview-zoom";

const key = (over: Partial<KeyboardEvent>) =>
	({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent;

describe("the preview zoom", () => {
	it("follows fit until it is changed, then holds its own scale", () => {
		expect(scaleOf(FIT, 0.8)).toBe(0.8);
		expect(scaleOf(FIT, 1.3)).toBe(1.3);
		expect(scaleOf({ fit: false, scale: 2 }, 0.8)).toBe(2);
	});

	it("steps in and out from wherever it is, fit included", () => {
		expect(zoomIn(FIT, 0.8)).toEqual({ fit: false, scale: 0.9 });
		expect(zoomOut(FIT, 0.8)).toEqual({ fit: false, scale: 0.75 });
		expect(zoomIn({ fit: false, scale: 1 }, 0.5)).toEqual({ fit: false, scale: 1.1 });
		expect(zoomOut({ fit: false, scale: 1 }, 0.5)).toEqual({ fit: false, scale: 0.9 });
		// Between two steps it goes to the next one, not past it.
		expect(zoomIn({ fit: false, scale: 1.04 }, 1)).toEqual({ fit: false, scale: 1.1 });
	});

	it("stops at the ends and says so", () => {
		const most: Zoom = { fit: false, scale: MAX_ZOOM };
		const least: Zoom = { fit: false, scale: MIN_ZOOM };
		expect(zoomIn(most, 1)).toEqual(most);
		expect(zoomOut(least, 1)).toEqual(least);
		expect(canZoomIn(most, 1)).toBe(false);
		expect(canZoomOut(least, 1)).toBe(false);
		expect(canZoomIn(FIT, 1)).toBe(true);
		expect(scaleOf({ fit: false, scale: 40 }, 1)).toBe(MAX_ZOOM);
		expect(scaleOf(FIT, 0.01)).toBe(MIN_ZOOM);
	});

	it("turns the wheel a notch at a time, up for in", () => {
		const up = zoomByWheel({ fit: false, scale: 1 }, 1, -100);
		const down = zoomByWheel({ fit: false, scale: 1 }, 1, 100);
		expect(scaleOf(up, 1)).toBeCloseTo(1.1);
		expect(scaleOf(down, 1)).toBeCloseTo(1 / 1.1);
		expect(zoomByWheel(FIT, 1, 0)).toBe(FIT);
	});

	it("labels a scale as a whole percentage", () => {
		expect(zoomLabel(1)).toBe("100%");
		expect(zoomLabel(0.333)).toBe("33%");
		expect(zoomLabel(1.256)).toBe("126%");
	});

	it("reads the zoom keys on any layout, and nothing without the modifier", () => {
		expect(zoomCommandFor(key({ key: "=", code: "Equal", ctrlKey: true }), false)).toBe("in");
		expect(zoomCommandFor(key({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }), false)).toBe("in");
		expect(zoomCommandFor(key({ key: "+", code: "NumpadAdd", ctrlKey: true }), false)).toBe("in");
		expect(zoomCommandFor(key({ key: "-", code: "Minus", ctrlKey: true }), false)).toBe("out");
		expect(zoomCommandFor(key({ key: "-", code: "NumpadSubtract", ctrlKey: true }), false)).toBe("out");
		// A Belgian keyboard types à on the unshifted 0.
		expect(zoomCommandFor(key({ key: "à", code: "Digit0", ctrlKey: true }), false)).toBe("fit");
		expect(zoomCommandFor(key({ key: "0", code: "Digit0", metaKey: true }), true)).toBe("fit");
		expect(zoomCommandFor(key({ key: "=", code: "Equal" }), false)).toBeNull();
		expect(zoomCommandFor(key({ key: "=", code: "Equal", ctrlKey: true, altKey: true }), false)).toBeNull();
		expect(zoomCommandFor(key({ key: "c", code: "KeyC", ctrlKey: true }), false)).toBeNull();
	});
});
