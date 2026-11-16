import { describe, expect, it } from "vitest";
import { listCommandFor, stepFor } from "./list-keys";
import type { KeyLike } from "./shortcuts";

function press(init: Partial<KeyLike> & { key: string }): KeyLike {
	return { code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init };
}

describe("listCommandFor", () => {
	it("moves with the arrows, and extends with Shift", () => {
		expect(listCommandFor(press({ key: "ArrowDown" }), false)).toEqual({ kind: "move", by: "down", extend: false });
		expect(listCommandFor(press({ key: "ArrowUp", shiftKey: true }), false)).toEqual({ kind: "move", by: "up", extend: true });
		expect(listCommandFor(press({ key: "Home" }), false)).toEqual({ kind: "move", by: "first", extend: false });
		expect(listCommandFor(press({ key: "End", shiftKey: true }), false)).toEqual({ kind: "move", by: "last", extend: true });
	});

	it("leaves an arrow with Control or Alt to the platform", () => {
		expect(listCommandFor(press({ key: "ArrowDown", ctrlKey: true }), false)).toBeNull();
		expect(listCommandFor(press({ key: "ArrowLeft", altKey: true }), false)).toBeNull();
	});

	it("previews on Space and opens on Enter", () => {
		expect(listCommandFor(press({ key: " ", code: "Space" }), false)).toEqual({ kind: "preview" });
		expect(listCommandFor(press({ key: "Enter" }), false)).toEqual({ kind: "open" });
	});

	it("renames on F2 and deletes on Delete, and leaves Backspace alone now there are no folders", () => {
		expect(listCommandFor(press({ key: "F2" }), false)).toEqual({ kind: "rename" });
		expect(listCommandFor(press({ key: "Delete" }), false)).toEqual({ kind: "delete" });
		expect(listCommandFor(press({ key: "Backspace" }), false)).toBeNull();
	});

	it("reads the modifier keys as Control off a Mac and Command on one", () => {
		expect(listCommandFor(press({ key: "a", ctrlKey: true }), false)).toEqual({ kind: "select-all" });
		expect(listCommandFor(press({ key: "d", metaKey: true }), true)).toEqual({ kind: "duplicate" });
		expect(listCommandFor(press({ key: "c", ctrlKey: true }), false)).toEqual({ kind: "copy" });
		expect(listCommandFor(press({ key: "x", ctrlKey: true }), false)).toEqual({ kind: "cut" });
		expect(listCommandFor(press({ key: "v", ctrlKey: true }), false)).toEqual({ kind: "paste" });
	});

	it("does not take a bare letter, so typing in a field is never a command", () => {
		expect(listCommandFor(press({ key: "a" }), false)).toBeNull();
		expect(listCommandFor(press({ key: "d" }), false)).toBeNull();
	});

	it("clears on Escape", () => {
		expect(listCommandFor(press({ key: "Escape" }), false)).toEqual({ kind: "clear" });
	});
});

describe("stepFor", () => {
	it("goes one row in a list and ignores left and right", () => {
		expect(stepFor("down", 1)).toBe(1);
		expect(stepFor("up", 1)).toBe(-1);
		expect(stepFor("left", 1)).toBe(0);
	});

	it("goes a whole row of tiles up and down in a grid", () => {
		expect(stepFor("down", 4)).toBe(4);
		expect(stepFor("up", 4)).toBe(-4);
		expect(stepFor("right", 4)).toBe(1);
		expect(stepFor("left", 4)).toBe(-1);
	});
});
