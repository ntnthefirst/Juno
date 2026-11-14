import { describe, expect, it } from "vitest";
import {
	clickSelection,
	moveSelection,
	NO_SELECTION,
	pruneSelection,
	selectEverything,
	selectOnly,
} from "./list-selection";

const ROWS = ["a", "b", "c", "d", "e"];
const plain = { toggle: false, range: false };
const ctrl = { toggle: true, range: false };
const shift = { toggle: false, range: true };

describe("clickSelection", () => {
	it("selects only the row a plain click lands on", () => {
		const state = clickSelection(selectOnly("a"), ROWS, "c", plain);
		expect(state).toEqual({ selected: ["c"], anchor: "c", focus: "c" });
	});

	it("adds and takes away one row with Ctrl", () => {
		let state = clickSelection(selectOnly("a"), ROWS, "c", ctrl);
		expect(state.selected).toEqual(["a", "c"]);
		state = clickSelection(state, ROWS, "a", ctrl);
		expect(state.selected).toEqual(["c"]);
	});

	it("selects the run from the anchor with Shift, in list order", () => {
		const state = clickSelection(selectOnly("d"), ROWS, "b", shift);
		expect(state.selected).toEqual(["b", "c", "d"]);
		expect(state.anchor).toBe("d");
		expect(state.focus).toBe("b");
	});

	it("keeps the anchor when a Shift run is extended again", () => {
		let state = clickSelection(selectOnly("b"), ROWS, "d", shift);
		state = clickSelection(state, ROWS, "e", shift);
		expect(state.selected).toEqual(["b", "c", "d", "e"]);
	});

	it("adds a run to what is held with Ctrl and Shift together", () => {
		let state = clickSelection(selectOnly("a"), ROWS, "c", ctrl);
		state = clickSelection(state, ROWS, "e", { toggle: true, range: true });
		expect(state.selected).toEqual(["a", "c", "d", "e"]);
	});

	it("falls back to a plain click when there is no anchor", () => {
		expect(clickSelection(NO_SELECTION, ROWS, "b", shift).selected).toEqual(["b"]);
	});
});

describe("moveSelection", () => {
	it("goes to the first row when nothing is focused", () => {
		expect(moveSelection(NO_SELECTION, ROWS, 1, false).focus).toBe("a");
		expect(moveSelection(NO_SELECTION, ROWS, -1, false).focus).toBe("e");
	});

	it("moves by the step and stops at the ends", () => {
		expect(moveSelection(selectOnly("b"), ROWS, 1, false)).toEqual(selectOnly("c"));
		expect(moveSelection(selectOnly("e"), ROWS, 1, false)).toEqual(selectOnly("e"));
		expect(moveSelection(selectOnly("b"), ROWS, 3, false)).toEqual(selectOnly("e"));
		expect(moveSelection(selectOnly("b"), ROWS, "first", false)).toEqual(selectOnly("a"));
		expect(moveSelection(selectOnly("b"), ROWS, "last", false)).toEqual(selectOnly("e"));
	});

	it("grows and shrinks a run with Shift", () => {
		let state = moveSelection(selectOnly("b"), ROWS, 1, true);
		state = moveSelection(state, ROWS, 1, true);
		expect(state.selected).toEqual(["b", "c", "d"]);
		state = moveSelection(state, ROWS, -1, true);
		expect(state.selected).toEqual(["b", "c"]);
		expect(state.anchor).toBe("b");
	});

	it("is empty for an empty list", () => {
		expect(moveSelection(selectOnly("a"), [], 1, false)).toEqual(NO_SELECTION);
	});
});

describe("selectEverything and pruneSelection", () => {
	it("selects every row and keeps the focus", () => {
		const state = selectEverything(selectOnly("c"), ROWS);
		expect(state.selected).toEqual(ROWS);
		expect(state.focus).toBe("c");
	});

	it("drops rows the list no longer has", () => {
		const state = pruneSelection({ selected: ["a", "c"], anchor: "c", focus: "c" }, ["a", "b"]);
		expect(state).toEqual({ selected: ["a"], anchor: null, focus: null });
	});

	it("hands back the same state when nothing went", () => {
		const state = selectOnly("a");
		expect(pruneSelection(state, ROWS)).toBe(state);
	});
});
