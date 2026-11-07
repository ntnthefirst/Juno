import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, normaliseAccelerator } from "./accelerator";

describe("normaliseAccelerator", () => {
	it("spells a shortcut one way", () => {
		expect(normaliseAccelerator("alt+ctrl+n")).toBe("Ctrl+Alt+N");
		expect(normaliseAccelerator("CommandOrControl+Shift+f5")).toBe("Ctrl+Shift+F5");
	});

	it("refuses a key with no modifier, which would take it from every other program", () => {
		expect(normaliseAccelerator("N")).toBeNull();
		expect(normaliseAccelerator("F5")).toBeNull();
	});

	it("refuses two keys, no key, and junk", () => {
		expect(normaliseAccelerator("Ctrl+A+B")).toBeNull();
		expect(normaliseAccelerator("Ctrl+Alt")).toBeNull();
		expect(normaliseAccelerator("Ctrl++")).toBeNull();
		expect(normaliseAccelerator("Ctrl+Banana")).toBeNull();
		expect(normaliseAccelerator(42)).toBeNull();
	});
});

describe("acceleratorFromEvent", () => {
	const none = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

	it("reads the physical key, so AZERTY and QWERTY agree", () => {
		expect(acceleratorFromEvent({ ...none, ctrlKey: true, altKey: true, code: "KeyN" })).toBe("Ctrl+Alt+N");
		expect(acceleratorFromEvent({ ...none, ctrlKey: true, code: "Digit1" })).toBe("Ctrl+1");
	});

	it("waits while only a modifier is down, and refuses a bare key", () => {
		expect(acceleratorFromEvent({ ...none, ctrlKey: true, code: "ControlLeft" })).toBeNull();
		expect(acceleratorFromEvent({ ...none, code: "KeyN" })).toBeNull();
	});
});
