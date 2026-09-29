import { describe, expect, it } from "vitest";
import type { MailBlock, MailContainer, MailLayout, MailNode, MailSpacing } from "../../shared/types";
import {
	blockToCode,
	breakpointCss,
	compileLayout,
	convertNodeToCode,
	emptyBox,
	emptyContainer,
	emptyLayout,
	layoutFromHtml,
	newBlock,
	normaliseLayout,
	parseLayout,
	serialiseLayout,
} from "./mail-layout";

/** A box the way a template saved before margin existed stored it: no `margin` key at all. */
function oldBox(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		fill: null,
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		borderWidth: 0,
		borderColor: null,
		borderStyle: "solid",
		borderSides: { top: true, right: true, bottom: true, left: true },
		strokeHidden: false,
		borderRadius: 0,
		corners: null,
		opacity: 1,
		effects: [],
		width: null,
		minHeight: null,
		clip: false,
		customCss: null,
		...extra,
	};
}

function oldText(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		color: null,
		fontFamily: null,
		fontSize: null,
		lineHeight: null,
		letterSpacing: null,
		weight: "normal",
		italic: false,
		decoration: "none",
		transform: "none",
		align: "left",
		verticalAlign: "top",
		...extra,
	};
}

const common = { grow: 0, alignSelf: "auto", hidden: false };

/** A representative canvas, exactly as an older template would have stored it. */
const OLD_LAYOUT = {
	version: 2,
	width: 600,
	widthMode: "fixed",
	minHeight: 320,
	fill: null,
	fonts: [],
	customCss: null,
	breakpoints: [
		{
			id: "phone",
			name: "Phone",
			maxWidth: 480,
			sections: {
				header: { box: { padding: { top: 8, right: 8, bottom: 8, left: 8 } }, layout: { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 8, wrap: false } },
				centred: { alignSelf: "auto" },
			},
			blocks: { hello: { text: { fontSize: 18 } } },
		},
	],
	children: [
		{
			id: "header",
			kind: "container",
			tag: "header",
			hidden: false,
			name: "Header",
			alignSelf: "auto",
			grow: 0,
			layout: { kind: "flex", direction: "row", justify: "between", align: "center", gap: 20, wrap: true },
			box: oldBox({ padding: { top: 16, right: 24, bottom: 16, left: 24 }, fill: { kind: "solid", color: "#f6f6fa", hidden: false }, clip: true }),
			children: [
				{ ...common, id: "hello", kind: "heading", tag: "h2", content: "Welkom", text: oldText({ weight: "semibold", verticalAlign: "middle" }), box: oldBox({ minHeight: 60 }) },
				{ ...common, id: "intro", kind: "text", tag: "p", html: "Dag <b>jij</b>", text: oldText({ align: "center" }), box: oldBox() },
				{ ...common, id: "list", kind: "text", tag: "ul", html: "<li>Een</li><li>Twee</li>", text: oldText(), box: oldBox() },
				{ ...common, id: "go", kind: "button", alignSelf: "start", label: "Bekijk", href: "https://example.be", background: "#4a3fa0", color: "#ffffff", radius: 4, text: oldText({ weight: "semibold", align: "center" }), box: oldBox({ padding: { top: 10, right: 18, bottom: 10, left: 18 } }) },
			],
		},
		{
			id: "centred",
			kind: "container",
			tag: "section",
			hidden: false,
			name: "Centred",
			alignSelf: "center",
			grow: 0,
			layout: { kind: "grid", columns: 2, gap: 12, align: "center" },
			box: oldBox({ width: 400, borderRadius: 8 }),
			children: [
				{ ...common, id: "pic", kind: "image", src: "https://example.be/a.png", alt: "A", width: 120, align: "center", href: null, box: oldBox() },
				{ ...common, id: "linked", kind: "image", src: "https://example.be/b.png", alt: "B", width: null, align: "right", href: "https://example.be", box: oldBox() },
				{ ...common, id: "rule", kind: "divider", color: "#e3e2ec", thickness: 1, box: oldBox(), grow: 1 },
				{ ...common, id: "gap", kind: "spacer", height: 16 },
			],
		},
		{
			id: "pushed",
			kind: "container",
			tag: "div",
			hidden: false,
			name: "Pushed",
			alignSelf: "end",
			grow: 0,
			layout: { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false },
			box: oldBox({ width: 300 }),
			children: [{ ...common, id: "last", kind: "text", tag: "p", html: "Rechts", text: oldText({ align: "right" }), box: oldBox() }],
		},
		{
			id: "cols",
			kind: "columns",
			hidden: false,
			name: "Columns",
			alignSelf: "auto",
			grow: 0,
			gap: 16,
			box: oldBox({ padding: { top: 4, right: 4, bottom: 4, left: 4 } }),
			rows: [
				{
					id: "row1",
					cells: [
						{ id: "c1", width: 40, verticalAlign: "top", box: oldBox({ padding: { top: 8, right: 8, bottom: 8, left: 8 }, clip: true }), children: [{ ...common, id: "cell-a", kind: "text", tag: "p", html: "Links", text: oldText(), box: oldBox() }] },
						{ id: "c2", width: null, verticalAlign: "middle", box: oldBox(), children: [{ ...common, id: "cell-b", kind: "text", tag: "p", html: "Rechts", text: oldText(), box: oldBox() }] },
					],
				},
			],
		},
		{ ...common, id: "code", kind: "html", html: "<p>Los</p>", css: "color:#333333" },
	],
};

/**
 * What the canvas above compiled to before margin and a grid's horizontal
 * alignment were added, captured from the compiler as it was. A saved template
 * has neither field, so both must read as zeros and stretch and change nothing.
 */
const GOLDEN_BODY =
	"<div data-juno-canvas=\"1\" style=\"max-width:600px;margin:0 auto;min-height:320px\"><header data-juno-section=\"Header\" data-juno-id=\"header\" class=\"jb-header\" style=\"display:block;display:flex;flex-direction:row;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;background-color:#f6f6fa;padding:16px 24px 16px 24px;overflow:hidden\"><h2 data-juno-block=\"heading\" data-juno-id=\"hello\" class=\"jb-hello\" style=\"margin:0;font-weight:600;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;min-height:60px\"><span data-juno-inner=\"1\" style=\"display:block\">Welkom</span></h2><p data-juno-block=\"text\" data-juno-id=\"intro\" style=\"margin:0;text-align:center\">Dag <b>jij</b></p><ul data-juno-block=\"text\" data-juno-id=\"list\" style=\"margin:0;padding-left:24px\"><li>Een</li><li>Twee</li></ul><a data-juno-block=\"button\" data-juno-id=\"go\" href=\"https://example.be\" style=\"display:inline-block;text-decoration:none;background:#4a3fa0;color:#ffffff;font-weight:600;text-align:center;padding:10px 18px 10px 18px;border-radius:4px;align-self:flex-start\">Bekijk</a></header><section data-juno-section=\"Centred\" data-juno-id=\"centred\" class=\"jb-centred\" style=\"display:block;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;align-items:center;border-radius:8px;width:400px;max-width:100%;box-sizing:border-box;margin-left:auto;margin-right:auto\"><img data-juno-block=\"image\" data-juno-id=\"pic\" src=\"https://example.be/a.png\" alt=\"A\" style=\"display:block;max-width:100%;width:120px;height:auto;margin:0 auto\"><a href=\"https://example.be\" data-juno-link=\"1\" style=\"display:inline-block\"><img data-juno-block=\"image\" data-juno-id=\"linked\" src=\"https://example.be/b.png\" alt=\"B\" style=\"display:block;max-width:100%;height:auto;margin-left:auto\"></a><hr data-juno-block=\"divider\" data-juno-id=\"rule\" style=\"border:0;border-top:1px solid #e3e2ec;width:100%;flex:1 1 0%\"><div data-juno-block=\"spacer\" data-juno-id=\"gap\" style=\"height:16px;line-height:0;font-size:0\">&nbsp;</div></section><div data-juno-section=\"Pushed\" data-juno-id=\"pushed\" style=\"display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;gap:12px;flex-wrap:nowrap;width:300px;max-width:100%;box-sizing:border-box;margin-left:auto\"><p data-juno-block=\"text\" data-juno-id=\"last\" style=\"margin:0;text-align:right\">Rechts</p></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" data-juno-columns=\"Columns\" data-juno-id=\"cols\" style=\"padding:4px 4px 4px 4px\"><tr data-juno-id=\"row1\"><td data-juno-id=\"c1\" width=\"40%\" valign=\"top\" style=\"width:40%;vertical-align:top;padding:8px 8px 8px 8px;overflow:hidden;padding-right:16px\"><p data-juno-block=\"text\" data-juno-id=\"cell-a\" style=\"margin:0\">Links</p></td><td data-juno-id=\"c2\" valign=\"middle\" style=\"vertical-align:middle;padding-left:8px\"><p data-juno-block=\"text\" data-juno-id=\"cell-b\" style=\"margin:0\">Rechts</p></td></tr></table><p data-juno-block=\"html\" data-juno-id=\"code\" style=\"color:#333333\">Los</p></div>";

const GOLDEN_CSS =
	"@media only screen and (max-width:480px){.jb-header{flex-direction:column !important;justify-content:flex-start !important;align-items:stretch !important;gap:8px !important;flex-wrap:nowrap !important;padding:8px 8px 8px 8px !important}.jb-hello{font-size:18px !important}.jb-centred{margin-left:0 !important;margin-right:0 !important}}";

describe("a canvas saved before margin existed", () => {
	it("compiles to the bytes it always did", () => {
		const layout = normaliseLayout(OLD_LAYOUT);
		if (!layout) throw new Error("the fixture did not parse");
		expect(compileLayout(layout)).toBe(GOLDEN_BODY);
		expect(breakpointCss(layout)).toBe(GOLDEN_CSS);
	});
});

const sides = (top: number, right: number, bottom: number, left: number): MailSpacing => ({ top, right, bottom, left });

function layoutOf(...children: MailNode[]): MailLayout {
	return { ...emptyLayout(), children };
}

function containerWith(over: Partial<MailContainer>, children: MailNode[] = []): MailContainer {
	return { ...emptyContainer("section", "Body"), id: "s1", children, ...over };
}

function textWith(margin: MailSpacing, id = "t1"): MailBlock {
	const block = newBlock("text");
	return { ...block, id, box: { ...emptyBox(), margin } } as MailBlock;
}

describe("margin in the model", () => {
	it("reads a box saved without one as zero on every side", () => {
		const layout = normaliseLayout(OLD_LAYOUT);
		const header = layout?.children[0] as MailContainer;
		expect(header.box.margin).toEqual(sides(0, 0, 0, 0));
	});

	it("keeps what was set, within the same limits as padding", () => {
		const layout = layoutOf(containerWith({ box: { ...emptyBox(), margin: sides(8, 300, -4, 12) } }));
		const back = parseLayout(serialiseLayout(layout));
		expect((back?.children[0] as MailContainer).box.margin).toEqual(sides(8, 200, 0, 12));
	});

	it("gives a new box no margin", () => {
		expect(emptyBox().margin).toEqual(sides(0, 0, 0, 0));
	});
});

describe("margin in the message", () => {
	it("writes only the sides that are set, after the element's own placement", () => {
		const html = compileLayout(layoutOf(containerWith({}, [textWith(sides(8, 0, 16, 0))])));
		expect(html).toContain('style="margin:0;margin-top:8px;margin-bottom:16px"');
	});

	it("writes nothing for a margin of zero", () => {
		const html = compileLayout(layoutOf(containerWith({}, [textWith(sides(0, 0, 0, 0))])));
		expect(html).not.toContain("margin-top");
		expect(html).not.toContain("margin-right");
		expect(html).not.toContain("margin-bottom");
		expect(html).not.toContain("margin-left");
	});

	it("keeps auto on the sides a centred container already sets, and writes the rest", () => {
		const centred = containerWith({ alignSelf: "center", box: { ...emptyBox(), width: 400, margin: sides(10, 20, 30, 40) } });
		const html = compileLayout(layoutOf(centred));
		expect(html).toContain("margin-left:auto;margin-right:auto;margin-top:10px;margin-bottom:30px");
		expect(html).not.toContain("margin-left:40px");
		expect(html).not.toContain("margin-right:20px");
	});

	it("keeps auto on the left of a container pushed to the end, and writes the right", () => {
		const pushed = containerWith({ alignSelf: "end", box: { ...emptyBox(), width: 400, margin: sides(0, 12, 0, 12) } });
		const html = compileLayout(layoutOf(pushed));
		expect(html).toContain("margin-left:auto;margin-right:12px");
		expect(html).not.toContain("margin-left:12px");
	});

	it("writes every side for a container inside another, where alignment is the parent's", () => {
		const inner = containerWith({ id: "inner", alignSelf: "center", box: { ...emptyBox(), margin: sides(1, 2, 3, 4) } });
		const html = compileLayout(layoutOf(containerWith({}, [inner])));
		expect(html).toContain("margin-top:1px;margin-right:2px;margin-bottom:3px;margin-left:4px");
		expect(html).toContain("align-self:center");
	});

	it("leaves a centred picture's sides to its alignment", () => {
		const picture = {
			...newBlock("image"),
			id: "p1",
			src: "https://example.be/a.png",
			align: "center" as const,
			box: { ...emptyBox(), margin: sides(6, 9, 6, 9) },
		} as MailBlock;
		const html = compileLayout(layoutOf(containerWith({}, [picture])));
		expect(html).toContain("margin:0 auto;");
		expect(html).toContain("margin-top:6px;margin-bottom:6px");
		expect(html).not.toContain("margin-left:9px");
		expect(html).not.toContain("margin-right:9px");
	});

	it("gives a columns table a margin and a cell none", () => {
		const cells = [
			{ id: "c1", width: null, verticalAlign: "top" as const, box: { ...emptyBox(), margin: sides(5, 5, 5, 5) }, children: [] },
		];
		const table: MailNode = {
			id: "tb",
			kind: "columns",
			hidden: false,
			name: "Columns",
			alignSelf: "auto",
			grow: 0,
			gap: 0,
			box: { ...emptyBox(), margin: sides(0, 0, 24, 0) },
			rows: [{ id: "r1", cells }],
		};
		const html = compileLayout(layoutOf(table));
		expect(html).toContain("margin-bottom:24px");
		expect(html).not.toContain("margin-top:5px");
		expect(html).not.toContain("margin-left:5px");
	});

	it("reads a margin back from the code view, and compiles the same again", () => {
		const layout = layoutOf(
			containerWith({ box: { ...emptyBox(), margin: sides(4, 0, 8, 0) } }, [
				textWith(sides(0, 0, 12, 0)),
				{ ...newBlock("heading"), id: "h1", box: { ...emptyBox(), margin: sides(2, 3, 0, 0) } } as MailBlock,
			]),
		);
		const html = compileLayout(layout);
		const back = layoutFromHtml(html);
		const container = back.children[0] as MailContainer;
		expect(container.box.margin).toEqual(sides(4, 0, 8, 0));
		expect(container.box.customCss).toBeNull();
		const [text, heading] = container.children as MailBlock[];
		expect(text && "box" in text ? text.box.margin : null).toEqual(sides(0, 0, 12, 0));
		expect(heading && "box" in heading ? heading.box.margin : null).toEqual(sides(2, 3, 0, 0));
		expect(compileLayout(back)).toBe(html);
	});

	it("reads a centred container back as centred, with the auto sides as zero", () => {
		const centred = containerWith({ alignSelf: "center", box: { ...emptyBox(), width: 400, margin: sides(10, 20, 30, 40) } });
		const back = layoutFromHtml(compileLayout(layoutOf(centred))).children[0] as MailContainer;
		expect(back.alignSelf).toBe("center");
		expect(back.box.margin).toEqual(sides(10, 0, 30, 0));
	});

	it("keeps a margin when a block becomes code", () => {
		const block = textWith(sides(7, 0, 0, 0));
		expect(blockToCode(block, [], []).css).toContain("margin-top:7px");
		const before = layoutOf(containerWith({}, [block]));
		const after = convertNodeToCode(before, "s1", "t1", []);
		expect(compileLayout(after)).toBe(compileLayout(before).replace('data-juno-block="text"', 'data-juno-block="html"'));
	});
});

describe("margin at a breakpoint", () => {
	function withOverride(box: Record<string, unknown>): MailLayout {
		const layout = layoutOf(containerWith({}, [textWith(sides(8, 0, 0, 0))]));
		return {
			...layout,
			breakpoints: [{ id: "phone", name: "Phone", maxWidth: 480, sections: {}, blocks: { t1: { box } } }],
		};
	}

	it("writes the margin the breakpoint changes and nothing else", () => {
		const parsed = normaliseLayout(withOverride({ margin: sides(8, 0, 20, 0) }));
		if (!parsed) throw new Error("did not parse");
		expect(breakpointCss(parsed)).toBe("@media only screen and (max-width:480px){.jb-t1{margin-bottom:20px !important}}");
	});

	it("puts a side back to zero where the breakpoint takes it away", () => {
		const parsed = normaliseLayout(withOverride({ margin: sides(0, 0, 0, 0) }));
		if (!parsed) throw new Error("did not parse");
		expect(breakpointCss(parsed)).toBe("@media only screen and (max-width:480px){.jb-t1{margin-top:0 !important}}");
	});
});

describe("a grid's alignment across its cells", () => {
	function gridWith(justify: "stretch" | "start" | "center" | "end"): MailLayout {
		return layoutOf(
			containerWith({ layout: { kind: "grid", columns: 2, gap: 12, align: "start", justify } }, [textWith(sides(0, 0, 0, 0))]),
		);
	}

	it("reads a grid saved without it as stretching, which is what a grid does", () => {
		const parsed = normaliseLayout(OLD_LAYOUT);
		const centred = parsed?.children[1] as MailContainer;
		expect(centred.layout).toMatchObject({ kind: "grid", justify: "stretch" });
	});

	it("writes nothing for stretch and justify-items for any other place", () => {
		expect(compileLayout(gridWith("stretch"))).not.toContain("justify-items");
		expect(compileLayout(gridWith("center"))).toContain("align-items:flex-start;justify-items:center");
		expect(compileLayout(gridWith("end"))).toContain("justify-items:flex-end");
	});

	it("reads it back from the code view", () => {
		for (const justify of ["stretch", "start", "center", "end"] as const) {
			const html = compileLayout(gridWith(justify));
			const back = layoutFromHtml(html).children[0] as MailContainer;
			expect(back.layout).toMatchObject({ kind: "grid", justify });
			expect(back.box.customCss).toBeNull();
			expect(compileLayout(layoutFromHtml(html))).toBe(html);
		}
	});

	it("puts stretch back at a breakpoint that takes the alignment away", () => {
		const layout: MailLayout = {
			...gridWith("center"),
			breakpoints: [
				{
					id: "phone",
					name: "Phone",
					maxWidth: 480,
					sections: { s1: { layout: { kind: "grid", columns: 2, gap: 12, align: "start", justify: "stretch" } } },
					blocks: {},
				},
			],
		};
		const parsed = normaliseLayout(layout);
		if (!parsed) throw new Error("did not parse");
		expect(breakpointCss(parsed)).toContain("justify-items:stretch !important");
	});
});
