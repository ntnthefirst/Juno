import { describe, expect, it } from "vitest";
import { columnsCss, marginCss, pictureAutoSides, sectionCss } from "./box-style";
import { emptyBox, emptyLayout, emptySection, newColumns } from "./canvas-actions";

const margin = { top: 10, right: 20, bottom: 30, left: 40 };

describe("margin on the canvas", () => {
	it("draws only the sides that are set", () => {
		expect(marginCss({ top: 8, right: 0, bottom: 0, left: 0 })).toEqual({ marginTop: 8 });
		expect(marginCss({ top: 0, right: 0, bottom: 0, left: 0 })).toEqual({});
	});

	it("leaves the sides an alignment gives auto to that alignment", () => {
		expect(marginCss(margin, { left: true, right: true })).toEqual({ marginTop: 10, marginBottom: 30 });
		expect(marginCss(margin, { left: true, right: false })).toEqual({ marginTop: 10, marginRight: 20, marginBottom: 30 });
		expect(pictureAutoSides("center")).toEqual({ left: true, right: true });
		expect(pictureAutoSides("right")).toEqual({ left: true, right: false });
		expect(pictureAutoSides("left")).toEqual({ left: false, right: false });
	});

	it("keeps a centred container in the middle whatever margin it has", () => {
		const section = { ...emptySection(), alignSelf: "center" as const, box: { ...emptyBox(), width: 400, margin } };
		const css = sectionCss(section, true);
		expect(css.marginLeft).toBe("auto");
		expect(css.marginRight).toBe("auto");
		expect(css.marginTop).toBe(10);
		expect(css.marginBottom).toBe(30);
	});

	it("writes every side inside another container, where the parent aligns", () => {
		const section = { ...emptySection(), alignSelf: "center" as const, box: { ...emptyBox(), margin } };
		const css = sectionCss(section, false);
		expect(css).toMatchObject({ marginTop: 10, marginRight: 20, marginBottom: 30, marginLeft: 40, alignSelf: "center" });
	});

	it("gives a columns table its margin the same way", () => {
		const columns = { ...newColumns(emptyLayout()), alignSelf: "end" as const, box: { ...emptyBox(), margin } };
		const css = columnsCss(columns, true);
		expect(css.marginLeft).toBe("auto");
		expect(css.marginRight).toBe(20);
	});
});

describe("a grid's alignment across its cells on the canvas", () => {
	it("draws nothing for stretch and the place for any other", () => {
		const grid = (justify: "stretch" | "center") => ({
			...emptySection(),
			layout: { kind: "grid" as const, columns: 2, gap: 8, align: "stretch" as const, justify },
		});
		expect(sectionCss(grid("stretch"), true).justifyItems).toBeUndefined();
		expect(sectionCss(grid("center"), true).justifyItems).toBe("center");
	});
});
