import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PreviewSheet } from "@shared/types";
import { announce } from "../lib/announce";
import { cellCount, contains, pick, rangeToTsv, selectAll, type Cell, type CellRange } from "../lib/cell-selection";
import { matchesCombo } from "../lib/shortcuts";
import { usePreviewZoom } from "../lib/use-preview-zoom";
import { ZoomControls } from "./ZoomControls";

type SheetPreviewProps = {
	sheets: PreviewSheet[];
	/** True when sheets past the limit were left out. */
	truncatedSheets: boolean;
};

/** "A", "B", ... "Z", "AA", as a spreadsheet names its columns. */
function columnName(index: number): string {
	let name = "";
	let n = index + 1;
	while (n > 0) {
		const rest = (n - 1) % 26;
		name = String.fromCharCode(65 + rest) + name;
		n = Math.floor((n - 1) / 26);
	}
	return name;
}

/** The cell a pointer is over, read from the attributes each cell carries. */
function cellAt(target: EventTarget | null): Cell | null {
	const element = target instanceof Element ? target.closest<HTMLElement>("[data-cell]") : null;
	if (!element) return null;
	const [row, column] = (element.dataset.cell ?? "").split(":").map(Number);
	return Number.isInteger(row) && Number.isInteger(column) ? { row: row!, column: column! } : null;
}

/**
 * A spreadsheet as its cells (decisions 76 and 83): one sheet at a time with
 * the sheets as tabs, column letters across the top and row numbers down the
 * side, the way the file's own program draws it. Cells are selected as there:
 * a click, Shift and a click, a drag, or Ctrl or Cmd A, and Ctrl or Cmd C
 * copies them as tab-separated text, which pastes as the same grid. Escape
 * lets go of the selection before it closes the preview. What was cut is said
 * under the table rather than hidden.
 */
export function SheetPreview({ sheets, truncatedSheets }: SheetPreviewProps) {
	const [index, setIndex] = useState(0);
	const [selection, setSelection] = useState<CellRange | null>(null);
	const [dragging, setDragging] = useState(false);
	const area = useRef<HTMLDivElement>(null);
	const zoom = usePreviewZoom(1, area);
	const sheet = sheets[Math.min(index, sheets.length - 1)];
	if (!sheet) {
		return <p className="p-8 text-[var(--ink-muted)]">This workbook has no sheets to show.</p>;
	}
	const width = sheet.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
	const notes = [
		sheet.truncatedRows ? `Showing the first ${sheet.rows.length} of ${sheet.totalRows} rows.` : "",
		sheet.truncatedColumns ? "Columns past the last one shown were left out." : "",
		truncatedSheets ? "Sheets past the last tab were left out." : "",
	].filter(Boolean);

	function choose(at: number) {
		setIndex(at);
		setSelection(null);
	}

	function down(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		const cell = cellAt(event.target);
		if (!cell) return;
		event.preventDefault();
		area.current?.focus({ preventScroll: true });
		setSelection((current) => pick(current, cell, event.shiftKey));
		setDragging(true);
	}

	function move(event: PointerEvent<HTMLDivElement>) {
		if (!dragging) return;
		const cell = cellAt(event.target);
		if (cell) setSelection((current) => (current ? { anchor: current.anchor, focus: cell } : current));
	}

	function key(event: KeyboardEvent<HTMLDivElement>) {
		if (!sheet) return;
		if (matchesCombo(event.nativeEvent, "mod+a")) {
			event.preventDefault();
			setSelection(selectAll(sheet.rows.length, width));
		} else if (matchesCombo(event.nativeEvent, "mod+c") && selection) {
			event.preventDefault();
			const cells = cellCount(selection);
			void navigator.clipboard.writeText(rangeToTsv(sheet.rows, selection)).then(() =>
				announce(cells === 1 ? "Cell copied." : `${cells} cells copied.`),
			);
		} else if (event.key === "Escape" && selection) {
			// The preview closes on the next Escape, not this one.
			event.preventDefault();
			setSelection(null);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
			<div className="flex h-[40px] flex-none items-center gap-3 border-b border-[var(--line)] px-3">
				{sheets.length > 1 ? (
					<div role="tablist" aria-label="Sheets" className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1.5">
						{sheets.map((entry, at) => (
							<button
								key={`${at}:${entry.name}`}
								type="button"
								role="tab"
								aria-selected={at === index}
								onClick={() => choose(at)}
								className={`h-[28px] flex-none rounded-[var(--radius-md)] px-3 text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
									at === index ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
								}`}
							>
								{entry.name || `Sheet ${at + 1}`}
							</button>
						))}
					</div>
				) : (
					<p className="min-w-0 flex-1 truncate text-sm text-[var(--ink-muted)]">{sheet.name}</p>
				)}
				{selection ? (
					<span className="tabular flex-none text-sm text-[var(--ink-muted)]" aria-live="polite">
						{cellCount(selection) === 1 ? "1 cell selected" : `${cellCount(selection)} cells selected`}
					</span>
				) : null}
				<ZoomControls zoom={zoom} fitLabel="Actual size" />
			</div>
			<div
				ref={area}
				tabIndex={0}
				role="grid"
				aria-label={`Cells of ${sheet.name || "the sheet"}`}
				aria-multiselectable
				onPointerDown={down}
				onPointerMove={move}
				onPointerUp={() => setDragging(false)}
				onPointerCancel={() => setDragging(false)}
				onKeyDown={key}
				data-sheet-grid
				className="min-h-0 flex-1 overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]"
			>
				<table className="tabular border-separate border-spacing-0 text-dense" style={{ zoom: zoom.scale }}>
					<thead>
						<tr>
							<th className="sticky top-0 left-0 z-20 h-[28px] min-w-[44px] border-r border-b border-[var(--line)] bg-[var(--sunken)]" />
							{Array.from({ length: width }, (_, column) => (
								<th
									key={column}
									scope="col"
									className="sticky top-0 z-10 h-[28px] min-w-[96px] border-r border-b border-[var(--line)] bg-[var(--sunken)] px-2 text-center text-micro text-[var(--ink-muted)]"
								>
									{columnName(column)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sheet.rows.map((row, at) => (
							<tr key={at}>
								<th
									scope="row"
									className="sticky left-0 z-10 h-[28px] border-r border-b border-[var(--line)] bg-[var(--sunken)] px-2 text-right text-micro font-[var(--weight-normal)] text-[var(--ink-muted)]"
								>
									{at + 1}
								</th>
								{Array.from({ length: width }, (_, column) => {
									const selected = contains(selection, { row: at, column });
									return (
										<td
											key={column}
											data-cell={`${at}:${column}`}
											aria-selected={selected}
											className={`h-[28px] max-w-[320px] truncate border-r border-b border-[var(--line)] px-2 whitespace-nowrap ${
												selected ? "bg-[var(--accent-soft)]" : ""
											}`}
											title={row[column] ?? ""}
										>
											{row[column] ?? ""}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{notes.length > 0 ? (
				<p className="flex-none border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-muted)]">{notes.join(" ")}</p>
			) : null}
		</div>
	);
}
