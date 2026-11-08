import { useCallback, useMemo, useState } from "react";
import { coversAll, withAll, withPick } from "./select-all";

export type RowSelection = {
	selectedIds: string[];
	/** The same ids, for a row asking whether it is held. */
	held: ReadonlySet<string>;
	/** Every row the list is showing is held. */
	allSelected: boolean;
	/** One row; `extend` (Shift) adds the run from the last row picked. */
	pick: (id: string, extend: boolean) => void;
	/** Adds every row on show, keeping what an earlier search put in. */
	selectAll: () => void;
	clear: () => void;
};

/**
 * What a list holds while rows are ticked, for the lists that select on the
 * page rather than through the service (Mail asks the service for every id it
 * matches, so it keeps its own). `visibleIds` is the list in the order it is
 * drawn, which is what a Shift run and select all go by.
 */
export function useRowSelection(visibleIds: readonly string[]): RowSelection {
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [anchor, setAnchor] = useState<string | null>(null);

	const pick = useCallback(
		(id: string, extend: boolean) => {
			setSelectedIds((current) => withPick(current, visibleIds, id, extend, anchor));
			setAnchor(id);
		},
		[visibleIds, anchor],
	);
	const selectAll = useCallback(() => {
		setSelectedIds((current) => withAll(current, visibleIds));
		setAnchor(visibleIds[visibleIds.length - 1] ?? null);
	}, [visibleIds]);
	const clear = useCallback(() => {
		setSelectedIds([]);
		setAnchor(null);
	}, []);

	const held = useMemo(() => new Set(selectedIds), [selectedIds]);
	return {
		selectedIds,
		held,
		allSelected: coversAll(visibleIds, selectedIds),
		pick,
		selectAll,
		clear,
	};
}
