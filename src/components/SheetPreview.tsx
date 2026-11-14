import { useState } from "react";
import type { PreviewSheet } from "@shared/types";

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

/**
 * A spreadsheet as its cells (decision 76): one sheet at a time with the
 * sheets as tabs, column letters across the top and row numbers down the
 * side, the way the file's own program draws it. What was cut is said under
 * the table rather than hidden.
 */
export function SheetPreview({ sheets, truncatedSheets }: SheetPreviewProps) {
	const [index, setIndex] = useState(0);
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

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
			{sheets.length > 1 ? (
				<div role="tablist" aria-label="Sheets" className="flex flex-none gap-1 overflow-x-auto border-b border-[var(--line)] px-3 py-1.5">
					{sheets.map((entry, at) => (
						<button
							key={`${at}:${entry.name}`}
							type="button"
							role="tab"
							aria-selected={at === index}
							onClick={() => setIndex(at)}
							className={`h-[28px] flex-none rounded-[var(--radius-md)] px-3 text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
								at === index ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
							}`}
						>
							{entry.name || `Sheet ${at + 1}`}
						</button>
					))}
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto" data-selectable>
				<table className="tabular border-separate border-spacing-0 text-dense">
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
								{Array.from({ length: width }, (_, column) => (
									<td
										key={column}
										className="h-[28px] max-w-[320px] truncate border-r border-b border-[var(--line)] px-2 whitespace-nowrap"
										title={row[column] ?? ""}
									>
										{row[column] ?? ""}
									</td>
								))}
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
