/**
 * Cells selected in a spreadsheet's preview (decision 83): a click picks one,
 * Shift and a click or a drag stretch a rectangle from it, Ctrl or Cmd A
 * takes every cell, and a copy is the rectangle as tab-separated text, which
 * pastes into Excel, Numbers or a mail as the same grid.
 *
 * No browser in here, so every rule is tested in plain Node.
 */
export type Cell = { row: number; column: number };

/** Where the selection started and where it reaches now. */
export type CellRange = { anchor: Cell; focus: Cell };

export type Bounds = { top: number; left: number; bottom: number; right: number };

export function bounds(range: CellRange): Bounds {
	return {
		top: Math.min(range.anchor.row, range.focus.row),
		left: Math.min(range.anchor.column, range.focus.column),
		bottom: Math.max(range.anchor.row, range.focus.row),
		right: Math.max(range.anchor.column, range.focus.column),
	};
}

export function contains(range: CellRange | null, cell: Cell): boolean {
	if (!range) return false;
	const { top, left, bottom, right } = bounds(range);
	return cell.row >= top && cell.row <= bottom && cell.column >= left && cell.column <= right;
}

/** A click: one cell, or with Shift the rectangle from where the selection started. */
export function pick(range: CellRange | null, cell: Cell, extend: boolean): CellRange {
	return extend && range ? { anchor: range.anchor, focus: cell } : { anchor: cell, focus: cell };
}

/** Every cell of a sheet `rows` long and `width` wide, or null for an empty sheet. */
export function selectAll(rows: number, width: number): CellRange | null {
	if (rows <= 0 || width <= 0) return null;
	return { anchor: { row: 0, column: 0 }, focus: { row: rows - 1, column: width - 1 } };
}

/** How many cells a selection covers. */
export function cellCount(range: CellRange | null): number {
	if (!range) return 0;
	const { top, left, bottom, right } = bounds(range);
	return (bottom - top + 1) * (right - left + 1);
}

/**
 * One cell as tab-separated text holds it: as it is, or in quotes with its
 * quotes doubled when it holds a tab, a line break or a quote, the way Excel
 * writes and reads it.
 */
function field(value: string): string {
	return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The selected rectangle as tab-separated text, one line a row. Empty cells stay empty, so the grid keeps its shape. */
export function rangeToTsv(rows: readonly (readonly string[])[], range: CellRange): string {
	const { top, left, bottom, right } = bounds(range);
	const lines: string[] = [];
	for (let row = top; row <= bottom; row += 1) {
		const cells: string[] = [];
		for (let column = left; column <= right; column += 1) cells.push(field(rows[row]?.[column] ?? ""));
		lines.push(cells.join("\t"));
	}
	return lines.join("\r\n");
}
