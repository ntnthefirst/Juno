/**
 * Global shortcut strings, in the form Electron registers them ("Ctrl+Alt+N").
 *
 * A shortcut that works from any program must carry a modifier, or it would
 * take a letter away from every other window on the machine. Pure, so the
 * settings file, the settings page and the tests all use the same rule.
 */

export const DEFAULT_NEW_NOTE_ACCELERATOR = "Ctrl+Alt+N";

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Super"] as const;

const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
	ctrl: "Ctrl",
	control: "Ctrl",
	commandorcontrol: "Ctrl",
	cmdorctrl: "Ctrl",
	alt: "Alt",
	option: "Alt",
	shift: "Shift",
	super: "Super",
	meta: "Super",
	win: "Super",
	windows: "Super",
};

const NAMED_KEYS = new Set([
	"Space",
	"Tab",
	"Enter",
	"Backspace",
	"Delete",
	"Insert",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Up",
	"Down",
	"Left",
	"Right",
]);

function isKey(token: string): boolean {
	return /^[A-Z0-9]$/.test(token) || /^F([1-9]|1\d|2[0-4])$/.test(token) || NAMED_KEYS.has(token);
}

/**
 * The accelerator in its one spelling, or null when it is not a usable
 * shortcut: no modifier, no key, two keys, or something Electron would reject.
 */
export function normaliseAccelerator(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
	let key: string | null = null;
	for (const raw of value.split("+")) {
		const token = raw.trim();
		if (!token) return null;
		const modifier = MODIFIER_ALIASES[token.toLowerCase()];
		if (modifier) {
			modifiers.add(modifier);
			continue;
		}
		const candidate = token.length === 1 ? token.toUpperCase() : token[0]!.toUpperCase() + token.slice(1);
		if (!isKey(candidate) || key !== null) return null;
		key = candidate;
	}
	if (key === null || modifiers.size === 0) return null;
	return [...MODIFIER_ORDER.filter((name) => modifiers.has(name)), key].join("+");
}

type KeyEventLike = {
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
};

const CODE_NAMES: Record<string, string> = {
	Space: "Space",
	Tab: "Tab",
	Enter: "Enter",
	Backspace: "Backspace",
	Delete: "Delete",
	Insert: "Insert",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
};

/**
 * What a key press says, read from the physical key so a Belgian AZERTY
 * keyboard gives the same answer as a US one (styling.md section 5f). Null
 * while only a modifier is down, or when the key is not one a shortcut can use.
 */
export function acceleratorFromEvent(event: KeyEventLike): string | null {
	let key: string | null = null;
	const letter = /^Key([A-Z])$/.exec(event.code);
	const digit = /^Digit(\d)$/.exec(event.code);
	if (letter) key = letter[1]!;
	else if (digit) key = digit[1]!;
	else if (/^F([1-9]|1\d|2[0-4])$/.test(event.code)) key = event.code;
	else key = CODE_NAMES[event.code] ?? null;
	if (key === null) return null;
	const parts: string[] = [];
	if (event.ctrlKey) parts.push("Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	if (event.metaKey) parts.push("Super");
	return normaliseAccelerator([...parts, key].join("+"));
}
