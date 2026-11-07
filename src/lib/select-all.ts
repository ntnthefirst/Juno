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
