/**
 * Whether a selection covers every id a list matches. The list may render only
 * part of them, so the check is against the ids the service named, not the rows
 * on screen.
 */
export function coversAll(matching: readonly string[], selected: readonly string[]): boolean {
	if (matching.length === 0) return false;
	const chosen = new Set(selected);
	return matching.every((id) => chosen.has(id));
}

/** The selection with every matching id added, keeping what was already picked. */
export function withAll(selected: readonly string[], matching: readonly string[]): string[] {
	return [...new Set([...selected, ...matching])];
}

/**
 * A pick on one row. A plain pick toggles it. With `extend` (Shift held) and a
 * row picked before it, every row between the two in list order is added, which
 * is what a list does everywhere else. A run from a row that is no longer in the
 * list falls back to a plain pick.
 */
export function withPick(
	selected: readonly string[],
	ordered: readonly string[],
	id: string,
	extend: boolean,
	anchor: string | null,
): string[] {
	if (extend && anchor !== null) {
		const from = ordered.indexOf(anchor);
		const to = ordered.indexOf(id);
		if (from >= 0 && to >= 0) {
			return withAll(selected, ordered.slice(Math.min(from, to), Math.max(from, to) + 1));
		}
	}
	return selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
}
