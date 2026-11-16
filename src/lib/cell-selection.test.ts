import { describe, expect, it } from "vitest";
import { bounds, cellCount, contains, pick, rangeToTsv, selectAll, type CellRange } from "./cell-selection";

const SHEET = [
	["Soort", "Dikte", "Prijs per m2"],
	["Eik", "38 mm", "92"],
	["Essen", "", "74"],
	["Notitie", 'met "aanhalingstekens"', "twee\nregels"],
];

describe("selecting cells in a sheet's preview", () => {
	it("picks one cell, and stretches from where it started with Shift, either way", () => {
		const one = pick(null, { row: 2, column: 2 }, false);
		expect(one).toEqual({ anchor: { row: 2, column: 2 }, focus: { row: 2, column: 2 } });
		const back = pick(one, { row: 0, column: 0 }, true);
		expect(bounds(back)).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
		expect(contains(back, { row: 1, column: 1 })).toBe(true);
		expect(contains(back, { row: 3, column: 1 })).toBe(false);
		expect(cellCount(back)).toBe(9);
		// Without Shift a click starts again.
		expect(pick(back, { row: 3, column: 0 }, false)).toEqual({ anchor: { row: 3, column: 0 }, focus: { row: 3, column: 0 } });
	});

	it("takes every cell, and nothing of an empty sheet", () => {
		expect(selectAll(4, 3)).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 3, column: 2 } });
		expect(selectAll(0, 3)).toBeNull();
		expect(cellCount(null)).toBe(0);
	});

	it("copies the rectangle as tab-separated text that keeps its shape", () => {
		const range: CellRange = { anchor: { row: 2, column: 2 }, focus: { row: 0, column: 0 } };
		expect(rangeToTsv(SHEET, range)).toBe("Soort\tDikte\tPrijs per m2\r\nEik\t38 mm\t92\r\nEssen\t\t74");
	});

	it("quotes a cell with a tab, a line break or a quote, as Excel does", () => {
		const range: CellRange = { anchor: { row: 3, column: 1 }, focus: { row: 3, column: 2 } };
		expect(rangeToTsv(SHEET, range)).toBe('"met ""aanhalingstekens"""\t"twee\nregels"');
	});

	it("fills a short row with empty cells, so the columns stay in place", () => {
		const rows = [["a", "b", "c"], ["d"]];
		expect(rangeToTsv(rows, { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 2 } })).toBe("a\tb\tc\r\nd\t\t");
	});
});
