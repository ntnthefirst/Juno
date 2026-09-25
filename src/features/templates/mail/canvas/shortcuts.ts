/**
 * The mail template editor's keyboard, which is Figma's where Figma has one.
 *
 * A key press becomes a named action here and nowhere else, so the editor, the
 * stage and the list of shortcuts on the toolbar all read the same table, and
 * the table can be tested without a window.
 */
import { isMac } from "../../../../lib/platform";

export type ShortcutAction =
	| "delete"
	| "undo"
	| "redo"
	| "copy"
	| "cut"
	| "paste"
	| "duplicate"
	| "save"
	| "hide"
	| "edit"
	| "parent"
	| "next"
	| "previous"
	| "earlier"
	| "later"
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "text-left"
	| "text-center"
	| "text-right"
	| "text-justify"
	| "align-left"
	| "align-center"
	| "align-right"
	| "align-top"
	| "align-middle"
	| "align-bottom"
	| "add-section"
	| "add-text"
	| "add-heading"
	| "add-button"
	| "add-image"
	| "add-field"
	| "add-divider"
	| "add-spacer"
	| "zoom-in"
	| "zoom-out"
	| "zoom-reset"
	| "zoom-fit"
	| "help";

/** The parts of a key press the table reads, so a test can hand it a plain object. */
export type KeyPress = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Letters are read from `code`, so Alt with a letter on a Mac, which types a symbol, still counts. */
function letter(press: KeyPress): string | null {
	return /^Key[A-Z]$/.test(press.code) ? press.code.slice(3).toLowerCase() : null;
}

const TOOLS: Record<string, ShortcutAction> = {
	f: "add-section",
	t: "add-text",
	h: "add-heading",
	b: "add-button",
	i: "add-image",
	e: "add-field",
	l: "add-divider",
	s: "add-spacer",
};

const ALIGN: Record<string, ShortcutAction> = {
	a: "align-left",
	h: "align-center",
	d: "align-right",
	w: "align-top",
	v: "align-middle",
	s: "align-bottom",
};

const TEXT_ALIGN: Record<string, ShortcutAction> = {
	l: "text-left",
	t: "text-center",
	r: "text-right",
	j: "text-justify",
};

/** The action a key press asks for, or null when it is not one of the editor's. */
export function shortcutFor(press: KeyPress): ShortcutAction | null {
	const mod = press.ctrlKey || press.metaKey;
	const key = letter(press);

	if (mod && press.altKey) return key ? (TEXT_ALIGN[key] ?? null) : null;

	if (mod) {
		// Zoom by the key, not the code, so it works on any layout: "=" and "+"
		// share a key on most of them and not all.
		if (press.key === "=" || press.key === "+") return "zoom-in";
		if (press.key === "-" || press.key === "_") return "zoom-out";
		if (press.code === "Digit0") return "zoom-reset";
		switch (key) {
			case "z":
				return press.shiftKey ? "redo" : "undo";
			case "y":
				return "redo";
			case "c":
				return press.shiftKey ? null : "copy";
			case "x":
				return press.shiftKey ? "strike" : "cut";
			case "v":
				return press.shiftKey ? null : "paste";
			case "d":
				return "duplicate";
			case "s":
				return "save";
			case "h":
				return press.shiftKey ? "hide" : null;
			case "b":
				return "bold";
			case "i":
				return "italic";
			case "u":
				return "underline";
			default:
				return null;
		}
	}

	if (press.altKey) return key && !press.shiftKey ? (ALIGN[key] ?? null) : null;

	if (press.shiftKey) {
		if (press.key === "Enter") return "parent";
		if (press.key === "Tab") return "previous";
		if (press.code === "Digit0") return "zoom-reset";
		if (press.code === "Digit1") return "zoom-fit";
		if (press.key === "?") return "help";
		if (press.key === "+") return "zoom-in";
		return null;
	}

	switch (press.key) {
		case "Delete":
		case "Backspace":
			return "delete";
		case "Enter":
			return "edit";
		case "Tab":
			return "next";
		case "ArrowUp":
		case "ArrowLeft":
			return "earlier";
		case "ArrowDown":
		case "ArrowRight":
			return "later";
		case "+":
		case "=":
			return "zoom-in";
		case "-":
			return "zoom-out";
		default:
			return key ? (TOOLS[key] ?? null) : null;
	}
}

/**
 * Whether a key press belongs to the field it was typed in. A shortcut never
 * takes a letter, a Delete or an arrow away from somebody typing.
 */
export function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName);
}

/**
 * Whether the press landed on a control that does something with it already:
 * Enter and Space press a button, and an arrow moves in a list. The canvas's
 * own keys that mean the same thing stand aside there.
 */
export function isControl(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.closest("button, a[href], [role=button], [role=tab], summary") !== null;
}

const MOD = isMac ? "Cmd" : "Ctrl";
const ALT = isMac ? "Option" : "Alt";

export type ShortcutGroup = { title: string; items: { label: string; keys: string }[] };

/** What the list on the toolbar shows, in the words the tooltips use. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		title: "Add",
		items: [
			{ label: "Section", keys: "F" },
			{ label: "Text", keys: "T" },
			{ label: "Heading", keys: "H" },
			{ label: "Button", keys: "B" },
			{ label: "Image", keys: "I" },
			{ label: "Input", keys: "E" },
			{ label: "Divider", keys: "L" },
			{ label: "Spacer", keys: "S" },
		],
	},
	{
		title: "Edit",
		items: [
			{ label: "Undo", keys: `${MOD}+Z` },
			{ label: "Redo", keys: `${MOD}+Shift+Z` },
			{ label: "Copy", keys: `${MOD}+C` },
			{ label: "Cut", keys: `${MOD}+X` },
			{ label: "Paste", keys: `${MOD}+V` },
			{ label: "Duplicate", keys: `${MOD}+D` },
			{ label: "Delete", keys: "Delete" },
			{ label: "Hide or show", keys: `${MOD}+Shift+H` },
			{ label: "Save", keys: `${MOD}+S` },
		],
	},
	{
		title: "Select",
		items: [
			{ label: "Edit the text", keys: "Enter" },
			{ label: "Select the section", keys: "Shift+Enter" },
			{ label: "Next layer", keys: "Tab" },
			{ label: "Previous layer", keys: "Shift+Tab" },
			{ label: "Let go", keys: "Esc" },
		],
	},
	{
		title: "Arrange",
		items: [
			{ label: "Move earlier", keys: "Up or Left" },
			{ label: "Move later", keys: "Down or Right" },
			{ label: "Align left, centre, right", keys: `${ALT}+A, H, D` },
			{ label: "Align top, middle, bottom", keys: `${ALT}+W, V, S` },
		],
	},
	{
		title: "Text",
		items: [
			{ label: "Bold", keys: `${MOD}+B` },
			{ label: "Italic", keys: `${MOD}+I` },
			{ label: "Underline", keys: `${MOD}+U` },
			{ label: "Strikethrough", keys: `${MOD}+Shift+X` },
			{ label: "Text left, centre, right", keys: `${MOD}+${ALT}+L, T, R` },
			{ label: "Justify", keys: `${MOD}+${ALT}+J` },
		],
	},
	{
		title: "View",
		items: [
			{ label: "Zoom in", keys: `${MOD}+=` },
			{ label: "Zoom out", keys: `${MOD}+-` },
			{ label: "Zoom to 100%", keys: "Shift+0" },
			{ label: "Zoom to fit", keys: "Shift+1" },
			{ label: "Pan", keys: "Space and drag" },
			{ label: "These shortcuts", keys: "?" },
		],
	},
];

/** The keys for one action, for a tooltip. */
export function keysFor(label: string): string | null {
	for (const group of SHORTCUT_GROUPS) {
		const found = group.items.find((item) => item.label === label);
		if (found) return found.keys;
	}
	return null;
}
