import { describe, expect, it } from "vitest";
import type { MailBlock, MailLayout, MailSection, TemplateInput } from "../../shared/types";
import {
	compileLayout,
	emptyBox,
	emptyLayout,
	emptySection,
	defaultText,
	layoutFromHtml,
	newBlock,
	normaliseLayout,
	parseLayout,
	safeHref,
	safeImageSrc,
	sanitiseDeclarations,
	sanitiseFragment,
	serialiseLayout,
	toColor,
} from "./mail-layout";

function sectionWith(blocks: MailBlock[], layout?: Partial<MailSection["layout"]>): MailSection {
	const section = emptySection("Body");
	section.blocks = blocks;
	if (layout) section.layout = { ...section.layout, ...layout } as MailSection["layout"];
	return section;
}

function layoutWith(sections: MailSection[]): MailLayout {
	return { ...emptyLayout(), sections };
}

function text(html: string): MailBlock {
	return { id: "t1", kind: "text", html, text: defaultText(), box: emptyBox(), grow: 0 };
}

describe("emptyLayout", () => {
	it("round-trips through serialise and parse unchanged", () => {
		const layout = emptyLayout();
		expect(parseLayout(serialiseLayout(layout))).toEqual(layout);
	});

	it("reads an unparseable row as an HTML-only template rather than throwing", () => {
		expect(parseLayout("not json at all")).toBeNull();
		expect(parseLayout(null)).toBeNull();
	});

	it("gives a layout with no sections one to start from", () => {
		const layout = normaliseLayout({ version: 1, sections: [] });
		expect(layout?.sections).toHaveLength(1);
	});
});

describe("compileLayout", () => {
	it("emits flex declarations for a flex section", () => {
		const html = compileLayout(
			layoutWith([sectionWith([text("Dag")], { kind: "flex", direction: "row", justify: "between", align: "center", gap: 20, wrap: true })]),
		);
		expect(html).toContain("display:flex");
		expect(html).toContain("flex-direction:row");
		expect(html).toContain("justify-content:space-between");
		expect(html).toContain("align-items:center");
		expect(html).toContain("gap:20px");
		expect(html).toContain("flex-wrap:wrap");
	});

	it("emits grid declarations with a column count", () => {
		const html = compileLayout(
			layoutWith([sectionWith([text("Dag")], { kind: "grid", columns: 3, gap: 8, align: "start" })]),
		);
		expect(html).toContain("display:grid");
		expect(html).toContain("grid-template-columns:repeat(3,1fr)");
	});

	it("never emits a position, whatever the author typed into custom CSS", () => {
		const layout = emptyLayout();
		layout.customCss = "position:absolute;top:10px;left:0;color:#ff0000";
		const normalised = normaliseLayout(layout)!;
		const html = compileLayout(normalised);
		expect(html).not.toContain("position");
		expect(html).not.toContain("top:10px");
		// The declaration that was not about positioning survives.
		expect(html).toContain("color:#ff0000");
	});

	it("keeps the frame width and the canvas height", () => {
		const layout = { ...emptyLayout(), width: 640, minHeight: 500 };
		const html = compileLayout(layout);
		expect(html).toContain("max-width:640px");
		expect(html).toContain("min-height:500px");
	});

	it("renders an image input as a picture and a text input as its token", () => {
		const inputs: TemplateInput[] = [
			{ key: "banner", label: "Banner", kind: "image", required: false },
			{ key: "scope", label: "Scope", kind: "text", required: false },
		];
		const blocks: MailBlock[] = [
			{ id: "f1", kind: "field", inputKey: "banner", text: defaultText(), box: emptyBox(), grow: 0 },
			{ id: "f2", kind: "field", inputKey: "scope", text: defaultText(), box: emptyBox(), grow: 0 },
		];
		const html = compileLayout(layoutWith([sectionWith(blocks)]), inputs);
		expect(html).toContain('<img data-juno-block="field"');
		expect(html).toContain('src="{{document.banner}}"');
		expect(html).toContain("{{document.scope}}");
	});

	it("shows a button with no usable target as words rather than a dead link", () => {
		const block = { ...newBlock("button"), href: "http://example.com" } as MailBlock;
		const html = compileLayout(layoutWith([sectionWith([block])]));
		expect(html).not.toContain("<a ");
		expect(html).toContain('data-juno-block="button"');
	});
});

describe("layoutFromHtml", () => {
	it("round-trips a compiled canvas back to the same HTML", () => {
		const original = layoutWith([
			sectionWith(
				[
					{ id: "h1", kind: "heading", level: 2, content: "Beste", text: defaultText(), box: emptyBox(), grow: 0 },
					text("Hier is uw voorstel."),
				],
				{ kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 16, wrap: false },
			),
		]);
		const html = compileLayout(original);
		const readBack = layoutFromHtml(html);
		// Ids are carried in the markup, so the second compile is byte-identical.
		expect(compileLayout(readBack)).toBe(html);
	});

	it("keeps hand-written markup as a raw block instead of dropping it", () => {
		// Written out rather than compiled, because the point is markup this
		// editor never produced sitting beside a block that it did.
		const html =
			'<div data-juno-canvas="1">' +
			'<div data-juno-section="Body" data-juno-id="s1" style="display:flex">' +
			'<div data-juno-block="text" data-juno-id="t1">Dag</div>' +
			"<table><tr><td>Met de hand</td></tr></table>" +
			"</div></div>";
		const readBack = layoutFromHtml(html);
		const kinds = readBack.sections.flatMap((section) => section.blocks.map((block) => block.kind));
		expect(kinds).toContain("html");
		expect(JSON.stringify(readBack)).toContain("Met de hand");
	});

	it("turns markup with no canvas marker into one section holding all of it", () => {
		const readBack = layoutFromHtml("<p>Zomaar getypt</p>");
		expect(readBack.sections).toHaveLength(1);
		expect(readBack.sections[0]?.blocks[0]?.kind).toBe("html");
		expect(JSON.stringify(readBack)).toContain("Zomaar getypt");
	});

	it("reads a grid section back as a grid", () => {
		const html = compileLayout(
			layoutWith([sectionWith([text("a")], { kind: "grid", columns: 4, gap: 10, align: "center" })]),
		);
		const section = layoutFromHtml(html).sections[0]!;
		expect(section.layout).toEqual({ kind: "grid", columns: 4, gap: 10, align: "center" });
	});

	it("hands an author's own declarations back to the custom CSS field", () => {
		const layout = emptyLayout();
		layout.sections[0]!.box.customCss = "text-transform:uppercase";
		const html = compileLayout(normaliseLayout(layout)!);
		expect(layoutFromHtml(html).sections[0]?.box.customCss).toBe("text-transform:uppercase");
	});
});

describe("sanitiseDeclarations", () => {
	it("drops every positioning property", () => {
		expect(sanitiseDeclarations("position:fixed;top:0;left:0;float:right;z-index:9")).toBe("");
	});

	it("refuses a declaration block that tries to become a stylesheet", () => {
		// Once the braces come out, "body   color" is not a property, so the
		// declaration goes rather than being guessed at.
		expect(sanitiseDeclarations("} body { color:#ff0000 } .x {")).toBe("");
	});

	it("keeps an ordinary declaration list", () => {
		expect(sanitiseDeclarations("color:#ff0000; text-transform:uppercase")).toBe(
			"color:#ff0000;text-transform:uppercase",
		);
	});

	it("drops the old Internet Explorer routes to running code", () => {
		expect(sanitiseDeclarations("width:expression(alert(1));background:url(javascript:alert(1))")).toBe("");
	});
});

describe("sanitiseFragment", () => {
	it("escapes a script rather than dropping it silently", () => {
		const out = sanitiseFragment("<script>alert(1)</script>Dag");
		expect(out).not.toContain("<script>");
		expect(out).toContain("&lt;script&gt;");
		expect(out).toContain("Dag");
	});

	it("strips every event handler with the tag that carried it", () => {
		expect(sanitiseFragment('<span onclick="steal()">x</span>')).toBe("<span>x</span>");
	});

	it("keeps a placeholder untouched", () => {
		expect(sanitiseFragment("Beste {{client.name}},")).toBe("Beste {{client.name}},");
	});

	it("keeps the words of a link whose target it refuses", () => {
		const out = sanitiseFragment('<a href="javascript:alert(1)">Klik</a>');
		expect(out).not.toContain("javascript");
		expect(out).toContain("Klik");
	});
});

describe("addresses and colours", () => {
	it("allows https and mailto and refuses plain http", () => {
		expect(safeHref("https://example.be")).toBe("https://example.be");
		expect(safeHref("mailto:hallo@example.be")).toBe("mailto:hallo@example.be");
		// http leaks the recipient's address to anyone on the path.
		expect(safeHref("http://example.be")).toBeNull();
		expect(safeImageSrc("http://example.be/a.png")).toBeNull();
	});

	it("lets a placeholder through as a target, because it is resolved later", () => {
		expect(safeImageSrc("{{document.banner}}")).toBe("{{document.banner}}");
	});

	it("takes a hex colour and nothing else", () => {
		expect(toColor("#4a3fa0")).toBe("#4a3fa0");
		expect(toColor("#fff")).toBe("#fff");
		expect(toColor("red;position:fixed")).toBeNull();
		expect(toColor("rgb(0,0,0)")).toBeNull();
	});
});
