/**
 * What a file list holds selected, the way a file manager does it.
 *
 * `focus` is the row the keyboard is on, `anchor` is where a Shift run starts,
 * and `selected` is what an action applies to. They are separate because a
 * Ctrl click moves the focus without changing anything else, and a Shift run
 * keeps its anchor however many times it is extended.
 *
 * Every function takes the ids in the order the list draws them and returns a
 * new state, so the rules are tested without a list to click.
 */
export type ListSelection = {
	selected: readonly string[];
	anchor: string | null;
	focus: string | null;
};

export const NO_SELECTION: ListSelection = { selected: [], anchor: null, focus: null };

export type ClickModifiers = {
	/** Ctrl, or Command on a Mac: add or take away one row. */
	toggle: boolean;
	/** Shift: everything between the anchor and this row. */
	range: boolean;
};

function between(ordered: readonly string[], from: string, to: string): string[] | null {
	const a = ordered.indexOf(from);
	const b = ordered.indexOf(to);
	if (a < 0 || b < 0) return null;
	return ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** A click on a row, with whatever modifiers were held. */
export function clickSelection(
	state: ListSelection,
	ordered: readonly string[],
	id: string,
	modifiers: ClickModifiers,
): ListSelection {
	if (modifiers.range && state.anchor !== null) {
		const run = between(ordered, state.anchor, id);
		if (run) {
			const selected = modifiers.toggle ? [...new Set([...state.selected, ...run])] : run;
			return { selected, anchor: state.anchor, focus: id };
		}
	}
	if (modifiers.toggle) {
		const selected = state.selected.includes(id)
			? state.selected.filter((other) => other !== id)
			: [...state.selected, id];
		return { selected, anchor: id, focus: id };
	}
	return { selected: [id], anchor: id, focus: id };
}

export type Step = number | "first" | "last";

/**
 * The arrow keys, Home and End. `step` is how far to go: one row in a list,
 * a whole row of tiles up or down in a grid. With `extend` (Shift) the run
 * from the anchor grows or shrinks; without it the focused row is the only
 * one selected.
 */
export function moveSelection(
	state: ListSelection,
	ordered: readonly string[],
	step: Step,
	extend: boolean,
): ListSelection {
	if (ordered.length === 0) return NO_SELECTION;
	const at = state.focus === null ? -1 : ordered.indexOf(state.focus);
	let target: number;
	if (step === "first") target = 0;
	else if (step === "last") target = ordered.length - 1;
	else if (at < 0) target = step > 0 ? 0 : ordered.length - 1;
	else target = Math.min(ordered.length - 1, Math.max(0, at + step));
	const id = ordered[target]!;
	if (extend) {
		const anchor = state.anchor !== null && ordered.includes(state.anchor) ? state.anchor : (state.focus ?? id);
		return { selected: between(ordered, anchor, id) ?? [id], anchor, focus: id };
	}
	return { selected: [id], anchor: id, focus: id };
}

/** Ctrl or Command A. The focus stays where it was. */
export function selectEverything(state: ListSelection, ordered: readonly string[]): ListSelection {
	if (ordered.length === 0) return NO_SELECTION;
	return { selected: [...ordered], anchor: state.anchor ?? ordered[0]!, focus: state.focus ?? ordered[0]! };
}

/** Drops what the list no longer shows, after a reload, a delete or a search. */
export function pruneSelection(state: ListSelection, ordered: readonly string[]): ListSelection {
	const shown = new Set(ordered);
	const selected = state.selected.filter((id) => shown.has(id));
	const anchor = state.anchor !== null && shown.has(state.anchor) ? state.anchor : null;
	const focus = state.focus !== null && shown.has(state.focus) ? state.focus : null;
	if (selected.length === state.selected.length && anchor === state.anchor && focus === state.focus) return state;
	return { selected, anchor, focus };
}

/** One row selected and focused, for a row opened from elsewhere or just made. */
export function selectOnly(id: string): ListSelection {
	return { selected: [id], anchor: id, focus: id };
}
