import { describe, expect, it } from "vitest";
import type { DocumentLayout, LayoutBlock, LayoutPage } from "../../shared/types";
import {
	compileLayout,
	contentHeightMm,
	contentWidthMm,
	DEFAULT_MARGIN,
	emptyLayout,
	layoutPlaceholders,
	parseLayout,
	sanitiseInline,
	serialiseLayout,
} from "./document-layout";

function heading(text: string): LayoutBlock {
	return { id: "h", kind: "heading", level: 1, text, align: "left" };
}

function page(blocks: LayoutBlock[]): LayoutPage {
	return { id: `page-${Math.random()}`, blocks, boxes: [] };
}

function layoutWithPages(pages: LayoutPage[]): DocumentLayout {
	return { version: 1, pageSize: "A4", margin: { ...DEFAULT_MARGIN }, pages };
}

describe("emptyLayout", () => {
	it("round-trips through serialiseLayout and parseLayout unchanged", () => {
		const layout = emptyLayout();
		expect(parseLayout(serialiseLayout(layout))).toEqual(layout);
	});
});

describe("contentWidthMm and contentHeightMm", () => {
	it("subtract the margin from the A4 page size", () => {
		expect(contentWidthMm(DEFAULT_MARGIN)).toBe(170);
		expect(contentHeightMm(DEFAULT_MARGIN)).toBe(251);
	});
});

describe("parseLayout: defensive input", () => {
	it("returns null for null", () => {
		expect(parseLayout(null)).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(parseLayout("")).toBeNull();
	});

	it("returns null for unparseable JSON", () => {
		expect(parseLayout("{")).toBeNull();
	});

	it("returns null for the wrong version", () => {
		expect(parseLayout('{"version":2}')).toBeNull();
	});

	it("returns null for a JSON array", () => {
		expect(parseLayout("[]")).toBeNull();
	});

	it("gives one empty page when the layout has zero pages", () => {
		const layout = parseLayout(JSON.stringify({ version: 1, pageSize: "A4", pages: [] }));
		expect(layout).not.toBeNull();
		expect(layout!.pages).toHaveLength(1);
		expect(layout!.pages[0]!.blocks).toEqual([]);
	});

	it("fills a missing margin from the default", () => {
		const layout = parseLayout(JSON.stringify({ version: 1, pageSize: "A4", pages: [] }));
		expect(layout!.margin).toEqual(DEFAULT_MARGIN);
	});

	it("drops a block with an unrecognised kind and keeps the rest", () => {
		const json = JSON.stringify({
			version: 1,
			pageSize: "A4",
			pages: [
				{
					id: "p1",
					blocks: [
						{ id: "b1", kind: "heading", level: 1, text: "Keep me", align: "left" },
						{ id: "b2", kind: "carrier-pigeon", text: "drop me" },
					],
					boxes: [],
				},
			],
		});
		const layout = parseLayout(json)!;
		expect(layout.pages[0]!.blocks).toHaveLength(1);
		expect(layout.pages[0]!.blocks[0]).toMatchObject({ kind: "heading", text: "Keep me" });
	});

	it("drops a box with a non-finite coordinate and keeps the rest", () => {
		const json = JSON.stringify({
			version: 1,
			pageSize: "A4",
			pages: [
				{
					id: "p1",
					blocks: [],
					boxes: [
						{
							id: "box-bad",
							xMm: NaN,
							yMm: 10,
							widthMm: 20,
							block: { id: "s1", kind: "spacer", heightMm: 5 },
						},
						{
							id: "box-good",
							xMm: 10,
							yMm: 10,
							widthMm: 20,
							block: { id: "s2", kind: "spacer", heightMm: 5 },
						},
					],
				},
			],
		});
		const layout = parseLayout(json)!;
		expect(layout.pages[0]!.boxes).toHaveLength(1);
		expect(layout.pages[0]!.boxes[0]!.id).toBe("box-good");
	});
});

describe("compileLayout: structure", () => {
	it("emits one .juno-page per page, in order", () => {
		const layout = layoutWithPages([page([heading("Page one")]), page([heading("Page two")])]);
		const html = compileLayout(layout);
		const first = html.indexOf("Page one");
		const second = html.indexOf("Page two");
		expect(html.match(/class="juno-page"/g)).toHaveLength(2);
		expect(first).toBeGreaterThan(-1);
		expect(second).toBeGreaterThan(first);
	});

	it("cancels the shell margin and applies the layout margin as padding", () => {
		const margin = { top: 10, right: 15, bottom: 12, left: 18 };
		const layout: DocumentLayout = { version: 1, pageSize: "A4", margin, pages: [page([])] };
		const html = compileLayout(layout);
		expect(html).toMatch(/@page\s*\{\s*size:\s*A4;\s*margin:\s*0;\s*\}/);
		expect(html).toContain('style="padding: 10mm 15mm 12mm 18mm"');
	});

	it("puts a box after the flow, positioned absolute with left/top/width in mm", () => {
		const layout: DocumentLayout = {
			version: 1,
			pageSize: "A4",
			margin: { ...DEFAULT_MARGIN },
			pages: [
				{
					id: "p1",
					blocks: [heading("Flowing")],
					boxes: [
						{
							id: "box-1",
							xMm: 120,
							yMm: 40,
							widthMm: 60,
							block: { id: "s1", kind: "spacer", heightMm: 5 },
						},
					],
				},
			],
		};
		const html = compileLayout(layout);
		expect(html).toContain(".juno-box {\n\tposition: absolute;\n}");
		expect(html).toContain('left: 120mm; top: 40mm; width: 60mm');
		expect(html.indexOf('class="juno-flow"')).toBeLessThan(html.indexOf('class="juno-box"'));
	});

	it("breaks after every page but the last", () => {
		const layout = layoutWithPages([
			page([heading("One")]),
			page([heading("Two")]),
			page([heading("Three")]),
		]);
		const html = compileLayout(layout);
		expect(html.match(/class="juno-page"/g)).toHaveLength(3);
		expect(html).toContain(".juno-page:not(:last-child)");
		expect(html).toContain("break-after: page");
		expect(html).toContain("page-break-after: always");
	});

	it("compiles the same layout to the same string every time", () => {
		const layout = layoutWithPages([page([heading("Stable")])]);
		expect(compileLayout(layout)).toBe(compileLayout(layout));
	});
});

describe("sanitiseInline", () => {
	it("keeps strong and a mailto link", () => {
		const html = sanitiseInline('<strong>Bold</strong> <a href="mailto:test@example.be">mail</a>');
		expect(html).toBe('<strong>Bold</strong> <a href="mailto:test@example.be">mail</a>');
	});

	it("strips a script tag", () => {
		const html = sanitiseInline("<script>alert(1)</script>");
		expect(html).not.toContain("<script>");
	});

	it("strips an onclick attribute", () => {
		const html = sanitiseInline('<strong onclick="alert(1)">bold</strong>');
		expect(html).not.toContain("onclick");
		expect(html).toBe("<strong>bold</strong>");
	});

	it("strips a javascript: href", () => {
		const html = sanitiseInline('<a href="javascript:alert(1)">click</a>');
		expect(html).not.toContain("javascript:");
		expect(html).toBe("<a>click</a>");
	});

	it("leaves a placeholder token intact", () => {
		expect(sanitiseInline("Beste {{ client.name }},")).toBe("Beste {{ client.name }},");
	});
});

describe("compileLayout: image sources", () => {
	it("renders nothing for an http (not https) source, without throwing", () => {
		const layout = layoutWithPages([
			page([{ id: "img1", kind: "image", src: "http://example.com/a.png", alt: "a", widthMm: 40, align: "left" }]),
		]);
		expect(() => compileLayout(layout)).not.toThrow();
		expect(compileLayout(layout)).not.toContain("<img");
	});

	it("renders nothing for a javascript: source, without throwing", () => {
		const layout = layoutWithPages([
			page([{ id: "img2", kind: "image", src: "javascript:alert(1)", alt: "a", widthMm: 40, align: "left" }]),
		]);
		expect(() => compileLayout(layout)).not.toThrow();
		expect(compileLayout(layout)).not.toContain("<img");
	});

	it("renders an https source", () => {
		const layout = layoutWithPages([
			page([{ id: "img3", kind: "image", src: "https://example.com/a.png", alt: "a", widthMm: 40, align: "left" }]),
		]);
		expect(compileLayout(layout)).toContain("<img");
	});
});

describe("layoutPlaceholders", () => {
	it("finds a placeholder in a heading, a table cell and a signature label, deduplicated and sorted", () => {
		const layout = layoutWithPages([
			page([
				heading("Voor {{ client.name }}"),
				{
					id: "t1",
					kind: "table",
					columns: [{ header: "Item", widthPct: 100 }],
					rows: [["{{ project.name }}"]],
					headerRow: true,
				},
				{ id: "sig1", kind: "signature", label: "{{ client.name }}", widthMm: 60 },
			]),
		]);
		expect(layoutPlaceholders(layout)).toEqual(["client.name", "project.name"]);
	});

	it("returns nothing for a layout with no placeholders", () => {
		expect(layoutPlaceholders(emptyLayout())).toEqual([]);
	});
});
