import { describe, expect, it } from "vitest";
import type { MailSectionLayout } from "@shared/types";
import { axesOf, isStretched, litAt, place, setSpread, setStretch, spreadOf, stretchAxes, withFlow } from "./alignment";

function flex(over: Partial<Extract<MailSectionLayout, { kind: "flex" }>> = {}): Extract<MailSectionLayout, { kind: "flex" }> {
	return { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false, ...over };
}

function grid(over: Partial<Extract<MailSectionLayout, { kind: "grid" }>> = {}): Extract<MailSectionLayout, { kind: "grid" }> {
	return { kind: "grid", columns: 2, gap: 12, align: "stretch", justify: "stretch", ...over };
}

describe("the alignment box", () => {
	it("reads left, centre and right from the field that runs across the page", () => {
		expect(axesOf(flex({ direction: "row", justify: "center", align: "end" }))).toEqual({ horizontal: "center", vertical: "end" });
		expect(axesOf(flex({ direction: "column", justify: "end", align: "center" }))).toEqual({ horizontal: "center", vertical: "end" });
		expect(axesOf(grid({ justify: "end", align: "start" }))).toEqual({ horizontal: "end", vertical: "start" });
	});

	it("sets both fields in one click, whichever way the container runs", () => {
		const row = place(flex({ direction: "row" }), 2, 1);
		expect(row).toMatchObject({ justify: "end", align: "center" });
		const column = place(flex({ direction: "column" }), 2, 1);
		expect(column).toMatchObject({ align: "end", justify: "center" });
		const cells = place(grid(), 1, 2);
		expect(cells).toMatchObject({ justify: "center", align: "end" });
	});

	it("leaves a click on the box to change only the other axis while the gap is Auto", () => {
		const spread = flex({ direction: "row", justify: "between", align: "start" });
		expect(place(spread, 0, 2)).toMatchObject({ justify: "between", align: "end" });
		const around = flex({ direction: "column", justify: "around", align: "start" });
		expect(place(around, 2, 0)).toMatchObject({ justify: "around", align: "end" });
	});

	it("takes a container out of stretch when a place is chosen", () => {
		const stretched = flex({ direction: "column", align: "stretch" });
		expect(isStretched(stretched, "horizontal")).toBe(true);
		expect(place(stretched, 0, 0)).toMatchObject({ align: "start", justify: "start" });
	});

	it("lights the place a value picks, and the line a spread or stretched axis leaves open", () => {
		const centred = flex({ direction: "row", justify: "center", align: "center" });
		expect(litAt(centred, 1, 1)).toBe("on");
		expect(litAt(centred, 0, 0)).toBe("off");
		// A column that stretches across has no left, centre or right; its top row is the line.
		const stretched = flex({ direction: "column", justify: "start", align: "stretch" });
		expect(litAt(stretched, 0, 0)).toBe("line");
		expect(litAt(stretched, 2, 0)).toBe("line");
		expect(litAt(stretched, 1, 1)).toBe("off");
		// A row spread along its flow lights the column its cross axis picks.
		const spread = flex({ direction: "row", justify: "between", align: "end" });
		expect(litAt(spread, 0, 2)).toBe("line");
		expect(litAt(spread, 0, 0)).toBe("off");
	});

	it("offers stretch across a flex container and both ways in a grid", () => {
		expect(stretchAxes(flex({ direction: "column" }))).toEqual(["horizontal"]);
		expect(stretchAxes(flex({ direction: "row" }))).toEqual(["vertical"]);
		expect(stretchAxes(grid())).toEqual(["horizontal", "vertical"]);
	});

	it("turns stretch on and off without touching the other axis", () => {
		const centred = flex({ direction: "row", justify: "center", align: "center" });
		const stretched = setStretch(centred, "vertical", true);
		expect(stretched).toMatchObject({ justify: "center", align: "stretch" });
		expect(setStretch(stretched, "vertical", false)).toMatchObject({ justify: "center", align: "start" });
		// Along the flow there is nothing to stretch.
		expect(setStretch(centred, "horizontal", true)).toBe(centred);
		const cells = setStretch(grid({ justify: "center", align: "end" }), "horizontal", true);
		expect(cells).toMatchObject({ justify: "stretch", align: "end" });
	});

	it("holds space between and around as the gap's Auto, and lifts it to the start", () => {
		const packed = flex({ direction: "row", justify: "center" });
		expect(spreadOf(packed)).toBeNull();
		const between = setSpread(packed, "between");
		expect(spreadOf(between)).toBe("between");
		expect(spreadOf(setSpread(between, "around"))).toBe("around");
		expect(setSpread(between, null)).toMatchObject({ justify: "start" });
		expect(setSpread(packed, null)).toBe(packed);
		expect(spreadOf(grid())).toBeNull();
		expect(setSpread(grid(), "between")).toEqual(grid());
	});
});

describe("changing the flow", () => {
	it("keeps a column and a row as they were, apart from the direction", () => {
		const column = flex({ direction: "column", justify: "center", align: "end", gap: 8 });
		expect(withFlow(column, "across")).toEqual({ ...column, direction: "row" });
		expect(withFlow(column, "down")).toBe(column);
	});

	it("carries the places on the page into a grid and back out", () => {
		const column = flex({ direction: "column", justify: "end", align: "center" });
		const cells = withFlow(column, "grid");
		expect(cells).toMatchObject({ kind: "grid", justify: "center", align: "end", gap: 12 });
		const row = withFlow(cells, "across");
		expect(row).toMatchObject({ kind: "flex", direction: "row", justify: "center", align: "end", wrap: false });
		const down = withFlow(cells, "down");
		expect(down).toMatchObject({ kind: "flex", direction: "column", justify: "end", align: "center" });
	});

	it("does not spread or stretch along the flow of what a grid becomes", () => {
		expect(withFlow(grid({ justify: "stretch", align: "stretch" }), "across")).toMatchObject({ justify: "start", align: "stretch" });
		expect(withFlow(flex({ direction: "row", justify: "between", align: "center" }), "grid")).toMatchObject({
			justify: "start",
			align: "center",
		});
	});
});
