import { describe, expect, it } from "vitest";
import { GROUPS, elementForKey, elementInfo, type GroupId } from "./elements";
import { ADD_KEYS, GROUP_ACTIONS, SHORTCUT_GROUPS, shortcutFor, type KeyPress } from "./shortcuts";

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

	it("has no key for a button of its own: the Button is an element in the Text menu", () => {
		expect(shortcutFor(press("b", "KeyB"))).toBeNull();
		expect(ADD_KEYS.map(([key]) => key)).not.toContain("b");
		expect(elementForKey("text", { code: "KeyB", ctrlKey: false, metaKey: false, altKey: false })).toBe("button");
		expect(elementInfo("button").group.id).toBe("text");
		const listed = SHORTCUT_GROUPS.flatMap((group) => group.items);
		expect(listed.some((item) => item.label === "Button" && item.keys === "Shift+T, B")).toBe(true);
		expect(listed.some((item) => item.label === "Button" && item.keys === "B")).toBe(false);
	});

	it("adds a block with a bare letter, and only a bare one", () => {
		expect(shortcutFor(press("t", "KeyT"))).toBe("add-text");
		expect(shortcutFor(press("f", "KeyF"))).toBe("add-containers");
		expect(shortcutFor(press("T", "KeyT", { shiftKey: true }))).toBe("menu-text");
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

	it("names every shortcut in a section of the list once", () => {
		for (const group of SHORTCUT_GROUPS) {
			const labels = group.items.map((item) => item.label);
			expect(new Set(labels).size).toBe(labels.length);
		}
	});

	it("gives no two shortcuts in the list the same keys", () => {
		const keys = SHORTCUT_GROUPS.flatMap((group) => group.items.map((item) => item.keys));
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("the toolbar's groups on the keyboard", () => {
	const letter = (key: string) => key.toUpperCase();

	/** TODO.md section 4a's table, element by element: the toolbar offers exactly these. */
	const ELEMENTS = [
		...["section", "div", "header", "footer", "main", "article", "aside", "nav"],
		...["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre", "address", "span", "ul", "ol", "button"],
		...["columns", "image", "linked-image", "divider", "field"],
	];

	it("gives every element in every group a key of its own, unique in its group", () => {
		for (const group of GROUPS) {
			const keys = group.elements.map((element) => element.key);
			expect(keys.every((key) => /^[A-Z0-9]$/.test(key))).toBe(true);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});

	it("covers every element the toolbar offers, and no element twice", () => {
		const ids = GROUPS.flatMap((group) => group.elements.map((element) => element.id));
		expect([...ids].sort()).toEqual([...ELEMENTS].sort());
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("adds the last-used element of a group with the group's letter, and opens its menu with Shift", () => {
		for (const group of GROUPS) {
			const code = `Key${group.key}`;
			expect(shortcutFor(press(group.key.toLowerCase(), code))).toBe(GROUP_ACTIONS[group.id].add);
			expect(shortcutFor(press(group.key, code, { shiftKey: true }))).toBe(GROUP_ACTIONS[group.id].menu);
		}
	});

	it("picks an element from an open menu by its own key, with Shift still held or not", () => {
		for (const group of GROUPS) {
			for (const element of group.elements) {
				const code = /^[0-9]$/.test(element.key) ? `Digit${element.key}` : `Key${element.key}`;
				const pressed = { code, ctrlKey: false, metaKey: false, altKey: false };
				expect(elementForKey(group.id, pressed)).toBe(element.id);
				expect(elementForKey(group.id, { ...pressed, ctrlKey: true })).toBeNull();
				expect(elementInfo(element.id).group.id).toBe(group.id);
			}
		}
		expect(elementForKey("containers", { code: "KeyZ", ctrlKey: false, metaKey: false, altKey: false })).toBeNull();
	});

	it("uses no letter twice for a bare add, and none that another bare shortcut has", () => {
		const letters = ADD_KEYS.map(([key]) => key);
		expect(new Set(letters).size).toBe(letters.length);
		// A bare letter is an add key or nothing: everything else in the table
		// needs Ctrl, Cmd, Alt or Shift.
		const bare = new Map<string, string>();
		for (let code = 65; code <= 90; code++) {
			const key = String.fromCharCode(code).toLowerCase();
			const action = shortcutFor(press(key, `Key${key.toUpperCase()}`));
			if (action) bare.set(key, action);
		}
		expect([...bare.keys()].sort()).toEqual([...letters].sort());
	});

	it("collides with nothing once Shift, Alt or Ctrl is held", () => {
		const groupIds = GROUPS.map((group) => group.id);
		const menus = new Set(groupIds.map((id: GroupId) => GROUP_ACTIONS[id].menu));
		for (let code = 65; code <= 90; code++) {
			const upper = String.fromCharCode(code);
			const key = `Key${upper}`;
			// Shift and a letter is a menu or nothing.
			const shifted = shortcutFor(press(upper, key, { shiftKey: true }));
			if (shifted) expect(menus.has(shifted)).toBe(true);
			// Alt and a letter is an alignment or nothing, and never an add or a menu.
			const alt = shortcutFor(press(upper.toLowerCase(), key, { altKey: true }));
			if (alt) expect(alt.startsWith("align-")).toBe(true);
			const ctrlAlt = shortcutFor(press(upper.toLowerCase(), key, { ctrlKey: true, altKey: true }));
			if (ctrlAlt) expect(ctrlAlt.startsWith("text-")).toBe(true);
			const ctrl = shortcutFor(press(upper.toLowerCase(), key, { ctrlKey: true }));
			if (ctrl) expect(ctrl.startsWith("add-") || ctrl.startsWith("menu-")).toBe(false);
		}
		// The group letters are the ones the menus answer to, and the table has one action per group for each.
		expect(new Set(GROUPS.map((group) => letter(group.key))).size).toBe(GROUPS.length);
	});
});
