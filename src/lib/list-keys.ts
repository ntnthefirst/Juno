import { LIST_COMBOS, matchesCombo, type KeyLike } from "./shortcuts";

/** What a key pressed in a file list asks for. */
export type ListCommand =
	| { kind: "move"; by: "up" | "down" | "left" | "right" | "first" | "last"; extend: boolean }
	| { kind: "preview" }
	| { kind: "open" }
	| { kind: "rename" }
	| { kind: "delete" }
	| { kind: "select-all" }
	| { kind: "duplicate" }
	| { kind: "copy" }
	| { kind: "cut" }
	| { kind: "paste" }
	| { kind: "clear" };

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

/**
 * The list keys, read from one event. Null for a key the list leaves alone,
 * so it reaches whatever else listens.
 *
 * Space is read by its key, not through a combo, because `event.key` is a
 * space character and no layout moves it. Shift with an arrow, Home or End
 * extends the selection; any other modifier on them is left to the platform.
 */
export function listCommandFor(event: KeyLike, mac?: boolean): ListCommand | null {
	const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
	const arrow = ARROWS[event.key];
	if (arrow && plain) return { kind: "move", by: arrow, extend: event.shiftKey };
	if ((event.key === "Home" || event.key === "End") && plain) {
		return { kind: "move", by: event.key === "Home" ? "first" : "last", extend: event.shiftKey };
	}
	if (event.key === " " && plain && !event.shiftKey) return { kind: "preview" };
	if (event.key === "Escape" && plain && !event.shiftKey) return { kind: "clear" };
	if (matchesCombo(event, LIST_COMBOS.open, mac)) return { kind: "open" };
	if (matchesCombo(event, LIST_COMBOS.rename, mac)) return { kind: "rename" };
	if (matchesCombo(event, LIST_COMBOS.remove, mac)) return { kind: "delete" };
	if (matchesCombo(event, LIST_COMBOS.selectAll, mac)) return { kind: "select-all" };
	if (matchesCombo(event, LIST_COMBOS.duplicate, mac)) return { kind: "duplicate" };
	if (matchesCombo(event, LIST_COMBOS.copy, mac)) return { kind: "copy" };
	if (matchesCombo(event, LIST_COMBOS.cut, mac)) return { kind: "cut" };
	if (matchesCombo(event, LIST_COMBOS.paste, mac)) return { kind: "paste" };
	return null;
}

/**
 * How far an arrow goes. In a list, up and down are one row and left and right
 * do nothing. In a grid of `columns` tiles, left and right are one tile and up
 * and down a whole row of them.
 */
export function stepFor(by: "up" | "down" | "left" | "right", columns: number): number {
	const across = Math.max(1, columns);
	if (by === "up") return across === 1 ? -1 : -across;
	if (by === "down") return across === 1 ? 1 : across;
	if (across === 1) return 0;
	return by === "left" ? -1 : 1;
}
