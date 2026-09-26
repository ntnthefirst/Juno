import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, shortcutFor, type KeyPress } from "./shortcuts";

function press(key: string, code: string, mods: Partial<Omit<KeyPress, "key" | "code">> = {}): KeyPress {
	return { key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("the editor's keyboard", () => {
	it("deletes with Delete and with Backspace", () => {
		expect(shortcutFor(press("Delete", "Delete"))).toBe("delete");
		expect(shortcutFor(press("Backspace", "Backspace"))).toBe("delete");
	});

	it("undoes and redoes the way Figma does, with Ctrl or Cmd", () => {
		expect(shortcutFor(press("z", "KeyZ", { ctrlKey: true }))).toBe("undo");
		expect(shortcutFor(press("Z", "KeyZ", { ctrlKey: true, shiftKey: true }))).toBe("redo");
		expect(shortcutFor(press("y", "KeyY", { ctrlKey: true }))).toBe("redo");
		expect(shortcutFor(press("z", "KeyZ", { metaKey: true }))).toBe("undo");
	});

	it("copies, cuts, pastes and duplicates", () => {
		expect(shortcutFor(press("c", "KeyC", { ctrlKey: true }))).toBe("copy");
		expect(shortcutFor(press("x", "KeyX", { ctrlKey: true }))).toBe("cut");
		expect(shortcutFor(press("v", "KeyV", { ctrlKey: true }))).toBe("paste");
		expect(shortcutFor(press("d", "KeyD", { ctrlKey: true }))).toBe("duplicate");
	});

	it("adds a block with a bare letter, and only a bare one", () => {
		expect(shortcutFor(press("t", "KeyT"))).toBe("add-text");
		expect(shortcutFor(press("f", "KeyF"))).toBe("add-section");
		expect(shortcutFor(press("T", "KeyT", { shiftKey: true }))).toBeNull();
		// Ctrl+Alt+T is centring text, not a text block.
		expect(shortcutFor(press("t", "KeyT", { ctrlKey: true, altKey: true }))).toBe("text-center");
	});

	it("reads Alt with a letter by its key, not by what it types", () => {
		// Option+A types "å" on a Mac.
		expect(shortcutFor(press("å", "KeyA", { altKey: true }))).toBe("align-left");
		expect(shortcutFor(press("v", "KeyV", { altKey: true }))).toBe("align-middle");
	});

	it("tells strikethrough from cut by Shift", () => {
		expect(shortcutFor(press("X", "KeyX", { ctrlKey: true, shiftKey: true }))).toBe("strike");
	});

	it("moves through the layers and up out of a block", () => {
		expect(shortcutFor(press("Enter", "Enter"))).toBe("edit");
		expect(shortcutFor(press("Enter", "Enter", { shiftKey: true }))).toBe("parent");
		expect(shortcutFor(press("Tab", "Tab"))).toBe("next");
		expect(shortcutFor(press("Tab", "Tab", { shiftKey: true }))).toBe("previous");
		expect(shortcutFor(press("ArrowUp", "ArrowUp"))).toBe("earlier");
		expect(shortcutFor(press("ArrowRight", "ArrowRight"))).toBe("later");
		// Alt and an arrow belong to the focused layer row, not to this table.
		expect(shortcutFor(press("ArrowUp", "ArrowUp", { altKey: true }))).toBeNull();
	});

	it("zooms from the keyboard", () => {
		expect(shortcutFor(press("=", "Equal", { ctrlKey: true }))).toBe("zoom-in");
		expect(shortcutFor(press("-", "Minus", { ctrlKey: true }))).toBe("zoom-out");
		expect(shortcutFor(press(")", "Digit0", { shiftKey: true }))).toBe("zoom-reset");
		expect(shortcutFor(press("!", "Digit1", { shiftKey: true }))).toBe("zoom-fit");
	});

	it("leaves everything else alone", () => {
		expect(shortcutFor(press("q", "KeyQ"))).toBeNull();
		expect(shortcutFor(press("a", "KeyA", { ctrlKey: true }))).toBeNull();
	});

	it("names every shortcut in the list once", () => {
		const labels = SHORTCUT_GROUPS.flatMap((group) => group.items.map((item) => item.label));
		expect(new Set(labels).size).toBe(labels.length);
	});
});
