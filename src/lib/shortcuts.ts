import type { ScreenId } from "../app/screens";

/**
 * The part of a keyboard event this file reads, so it can be tested without a
 * browser to make one.
 */
/** Read when it is needed, not at import, so a test can import this with no window. */
function detectMac(): boolean {
	return typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");
}

export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

type Parsed = { mod: boolean; shift: boolean; alt: boolean; key: string };

/**
 * `mod+shift+l`, `alt+arrowleft`, `mod+,`, `?`. `mod` is Command on a Mac and
 * Control everywhere else, so one string is the shortcut on both.
 */
function parse(combo: string): Parsed {
	const parts = combo.toLowerCase().split("+");
	const key = parts[parts.length - 1] ?? "";
	return { mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt"), key };
}

/**
 * Whether an event is that shortcut.
 *
 * Three decisions here come from the keyboards people actually have:
 *
 * - A digit is read from the physical key (`Digit3`), not from what it types.
 *   On a Belgian AZERTY layout the unshifted number row types `&`, `é`, `"`, so
 *   a shortcut written against `event.key` would never fire.
 * - Shift is ignored for punctuation. `?` is Shift and a key on every layout, in
 *   a different place on each, and `/` is the same key shifted on AZERTY.
 * - Letters and named keys must match Shift exactly, so Ctrl+L and Ctrl+Shift+L
 *   are two different shortcuts.
 */
export function matchesCombo(event: KeyLike, combo: string, mac: boolean = detectMac()): boolean {
	const wanted = parse(combo);
	const modDown = mac ? event.metaKey : event.ctrlKey;
	const strayMod = mac ? event.ctrlKey : event.metaKey;
	if (wanted.mod !== modDown || strayMod) return false;
	if (wanted.alt !== event.altKey) return false;

	const isDigit = /^[0-9]$/.test(wanted.key);
	const isLetter = /^[a-z]$/.test(wanted.key);
	const punctuation = !isDigit && !isLetter && wanted.key.length === 1;
	if (!punctuation && wanted.shift !== event.shiftKey) return false;

	if (isDigit) return event.code === `Digit${wanted.key}` || event.code === `Numpad${wanted.key}`;
	return event.key.toLowerCase() === wanted.key;
}

const NAMED: Record<string, string> = {
	arrowleft: "←",
	arrowright: "→",
	arrowup: "↑",
	arrowdown: "↓",
	escape: "Esc",
	enter: "Enter",
	delete: "Del",
};

/** The keys of a shortcut as they are drawn on this machine: ["Ctrl", "K"] or ["⌘", "K"]. */
export function formatCombo(combo: string, mac: boolean = detectMac()): string[] {
	const parsed = parse(combo);
	const keys: string[] = [];
	if (parsed.mod) keys.push(mac ? "⌘" : "Ctrl");
	if (parsed.alt) keys.push(mac ? "⌥" : "Alt");
	if (parsed.shift) keys.push(mac ? "⇧" : "Shift");
	keys.push(NAMED[parsed.key] ?? parsed.key.toUpperCase());
	return keys;
}

/** The shortcut for each place the sidebar goes. The digits follow the sidebar from the top. */
export const SCREEN_COMBOS: Partial<Record<ScreenId, string>> = {
	overview: "mod+1",
	calendar: "mod+2",
	clients: "mod+3",
	projects: "mod+4",
	mail: "mod+5",
	documents: "mod+6",
	agent: "mod+7",
};

export const COMBOS = {
	palette: "mod+k",
	newItem: "mod+n",
	settings: "mod+,",
	back: "alt+arrowleft",
	lock: "mod+shift+l",
	help: "mod+/",
} as const;

export type ShortcutRow = { combos: string[]; label: string };
export type ShortcutGroup = { title: string; rows: ShortcutRow[] };

/**
 * What the cheat sheet says. The general and navigation rows are the ones
 * `useShortcuts` listens for, and the mail rows are the keys the thread list
 * already handles, so the sheet and the code are about the same set.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		title: "General",
		rows: [
			{ combos: [COMBOS.palette], label: "Search and commands" },
			{ combos: [COMBOS.newItem], label: "New, on this screen" },
			{ combos: [COMBOS.back], label: "Back, out of a record" },
			{ combos: [COMBOS.settings], label: "Settings" },
			{ combos: [COMBOS.lock], label: "Lock Juno" },
			{ combos: [COMBOS.help], label: "This list" },
		],
	},
	{
		title: "Go to",
		rows: [
			{ combos: ["mod+1"], label: "Overview" },
			{ combos: ["mod+2"], label: "Calendar" },
			{ combos: ["mod+3"], label: "Clients" },
			{ combos: ["mod+4"], label: "Projects" },
			{ combos: ["mod+5"], label: "Mail" },
			{ combos: ["mod+6"], label: "Documents" },
			{ combos: ["mod+7"], label: "Agent" },
		],
	},
	{
		title: "In the mail list",
		rows: [
			{ combos: ["j", "k"], label: "Next and previous conversation" },
			{ combos: ["e"], label: "Archive" },
			{ combos: ["s"], label: "Flag" },
			{ combos: ["u"], label: "Mark read or unread" },
			{ combos: ["m"], label: "Move to a folder" },
			{ combos: ["delete"], label: "Move to trash" },
		],
	},
];
