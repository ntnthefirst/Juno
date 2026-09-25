import { describe, expect, it } from "vitest";
import type { MailBlock, MailFont, MailLayout, MailSection, MailTextStyle, TemplateInput } from "../../shared/types";
import {
	blockToCode,
	compileLayout,
	convertBlockToCode,
	fontLinks,
	sanitiseMarkup,
	googleFontHref,
	safeStylesheetHref,
	toFamily,
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
	return { id: "t1", kind: "text", html, text: defaultText(), box: emptyBox(), grow: 0, alignSelf: "auto", hidden: false };
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
					{
						id: "h1",
						kind: "heading",
						level: 2,
						content: "Beste",
						text: defaultText(),
						box: emptyBox(),
						grow: 0,
						alignSelf: "auto",
						hidden: false,
					},
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

describe("appearance", () => {
	function boxed(box: Partial<MailBlock["box"] & object>): MailLayout {
		const block = text("Dag");
		return layoutWith([sectionWith([{ ...block, box: { ...emptyBox(), ...box } }])]);
	}

	it("writes a flat colour a client can fall back to under every gradient", () => {
		const html = compileLayout(
			boxed({ fill: { kind: "gradient", angle: 90, from: "#ffffff", to: "#4a3fa0" } }),
		);
		// Outlook on Windows drops the image, so the first stop has to be there
		// as a plain colour or it paints nothing at all.
		expect(html).toContain("background-color:#ffffff");
		expect(html).toContain("background-image:linear-gradient(90deg,#ffffff,#4a3fa0)");
	});

	it("compiles a stroke, four corners, opacity and both kinds of effect", () => {
		const html = compileLayout(
			boxed({
				borderWidth: 2,
				borderColor: "#4a3fa0",
				borderStyle: "dashed",
				corners: { topLeft: 8, topRight: 0, bottomRight: 8, bottomLeft: 0 },
				opacity: 0.5,
				effects: [
					{ kind: "shadow", inset: true, x: 0, y: 2, blur: 6, spread: 1, color: "#16161d", opacity: 0.25 },
					{ kind: "blur", radius: 3 },
				],
			}),
		);
		expect(html).toContain("border:2px dashed #4a3fa0");
		expect(html).toContain("border-radius:8px 0px 8px 0px");
		expect(html).toContain("opacity:0.5");
		expect(html).toContain("box-shadow:inset 0px 2px 6px 1px rgba(22,22,29,0.25)");
		expect(html).toContain("filter:blur(3px)");
	});

	it("carries an appearance through a compile and a read back", () => {
		const layout = boxed({
			fill: { kind: "gradient", angle: 45, from: "#ffffff", to: "#4a3fa0" },
			borderWidth: 1,
			borderColor: "#e3e2ec",
			borderStyle: "dotted",
			borderRadius: 6,
			opacity: 0.8,
			effects: [
				{ kind: "shadow", inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "#16161d", opacity: 0.2 },
			],
		});
		const back = layoutFromHtml(compileLayout(layout));
		const box = back.sections[0]?.blocks[0]?.box;
		expect(box?.fill).toEqual({ kind: "gradient", angle: 45, from: "#ffffff", to: "#4a3fa0" });
		expect(box?.borderStyle).toBe("dotted");
		expect(box?.borderRadius).toBe(6);
		expect(box?.opacity).toBe(0.8);
		expect(box?.effects).toEqual([
			{ kind: "shadow", inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "#16161d", opacity: 0.2 },
		]);
		// Everything above is a control, so none of it lands in the escape hatch.
		expect(box?.customCss).toBeNull();
	});

	it("reads a canvas written before fills existed as a solid fill", () => {
		const layout = normaliseLayout({
			version: 1,
			background: "#f6f6fa",
			sections: [{ id: "s1", name: "Body", blocks: [{ id: "b1", kind: "text", html: "Dag", box: { background: "#ffffff" } }] }],
		});
		expect(layout?.fill).toEqual({ kind: "solid", color: "#f6f6fa" });
		expect(layout?.sections[0]?.blocks[0]?.box.fill).toEqual({ kind: "solid", color: "#ffffff" });
	});

	it("refuses a colour that is not a hex value anywhere in the appearance", () => {
		const layout = normaliseLayout({
			version: 1,
			fill: { kind: "solid", color: "red;position:fixed" },
			sections: [],
		});
		expect(layout?.fill).toBeNull();
	});
});

describe("typography", () => {
	function typed(patch: Partial<MailTextStyle>, fonts: MailFont[] = []): string {
		const block = text("Dag");
		const styled = { ...block, text: { ...defaultText(), ...patch } } as MailBlock;
		return compileLayout({ ...layoutWith([sectionWith([styled])]), fonts });
	}

	it("writes every part of the type a text block can have", () => {
		const html = typed({
			fontFamily: "Georgia",
			letterSpacing: -0.5,
			weight: "black",
			italic: true,
			decoration: "strike",
			transform: "upper",
			align: "center",
		});
		expect(html).toContain("font-family:Georgia, &#39;Times New Roman&#39;, serif");
		expect(html).toContain("letter-spacing:-0.5px");
		expect(html).toContain("font-weight:900");
		expect(html).toContain("font-style:italic");
		expect(html).toContain("text-decoration:line-through");
		expect(html).toContain("text-transform:uppercase");
		expect(html).toContain("text-align:center");
	});

	it("stands a linked family on its fallback, so a client that ignores the link still reads it", () => {
		const font: MailFont = {
			family: "Playfair Display",
			source: "google",
			href: null,
			weights: [400, 700],
			italic: false,
			fallback: "serif",
		};
		const html = typed({ fontFamily: "Playfair Display" }, [font]);
		expect(html).toContain("font-family:&#39;Playfair Display&#39;, Georgia, &#39;Times New Roman&#39;, serif");
	});

	it("always writes a heading's weight, because a client left to it makes it bold", () => {
		const heading = newBlock("heading");
		const html = compileLayout(
			layoutWith([sectionWith([{ ...heading, text: { ...defaultText(), weight: "normal" } } as MailBlock])]),
		);
		expect(html).toContain("font-weight:400");
	});

	it("keeps inline markup flowing as one paragraph when the text is pushed down its block", () => {
		const html = typed({ verticalAlign: "middle" });
		expect(html).toContain("justify-content:center");
		expect(html).toContain('<span data-juno-inner="1" style="display:block">Dag</span>');
		const back = layoutFromHtml(html).sections[0]?.blocks[0];
		expect(back?.kind === "text" ? back.html : null).toBe("Dag");
		expect(back?.kind === "text" ? back.text.verticalAlign : null).toBe("middle");
	});

	it("carries the type through a compile and a read back", () => {
		const style: Partial<MailTextStyle> = {
			fontFamily: "Verdana",
			letterSpacing: 1,
			weight: "light",
			italic: true,
			decoration: "underline",
			transform: "title",
		};
		const back = layoutFromHtml(typed(style)).sections[0]?.blocks[0];
		expect(back?.kind === "text" ? back.text : null).toMatchObject(style);
		expect(back?.kind === "text" ? back.box.customCss : "not text").toBeNull();
	});

	it("takes a family name and nothing that could close its quote", () => {
		expect(toFamily("Playfair Display")).toBe("Playfair Display");
		expect(toFamily("  Open   Sans ")).toBe("Open Sans");
		expect(toFamily("x';position:fixed;'")).toBeNull();
		expect(toFamily("")).toBeNull();
	});
});

describe("linked fonts", () => {
	it("builds a Google stylesheet with the axes in the order the API wants", () => {
		expect(googleFontHref("Playfair Display", [700, 400], true)).toBe(
			"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap",
		);
		expect(googleFontHref("Inter", [400], false)).toBe(
			"https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
		);
	});

	it("links only https stylesheets that cannot break out of their attribute", () => {
		expect(safeStylesheetHref("https://use.typekit.net/abc123.css")).toBe("https://use.typekit.net/abc123.css");
		expect(safeStylesheetHref("http://example.be/font.css")).toBeNull();
		expect(safeStylesheetHref('https://example.be/a.css" onload="x')).toBeNull();
		expect(safeStylesheetHref("javascript:alert(1)")).toBeNull();
	});

	it("reads fonts back, one entry per family, and links each one", () => {
		const layout = normaliseLayout({
			version: 1,
			sections: [],
			fonts: [
				{ family: "Lora", source: "google", weights: [400, 700], fallback: "serif" },
				{ family: "Lora", source: "google", weights: [900] },
				{ family: "Brand Sans", source: "link", href: "https://fonts.example.be/brand.css" },
				{ family: "Broken", source: "link", href: "http://nope.be/x.css" },
			],
		});
		expect(layout?.fonts.map((font) => font.family)).toEqual(["Lora", "Brand Sans", "Broken"]);
		// The broken one is kept so the author can correct it, and links nothing.
		expect(fontLinks(layout)).toEqual([
			"https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap",
			"https://fonts.example.be/brand.css",
		]);
	});
});

describe("placing and showing", () => {
	it("leaves a hidden block and a hidden section out of the message", () => {
		const hiddenBlock = { ...text("Weg"), hidden: true } as MailBlock;
		const hiddenSection = { ...sectionWith([text("Ook weg")]), hidden: true };
		const html = compileLayout(layoutWith([sectionWith([hiddenBlock, { ...text("Blijft"), id: "t2" } as MailBlock]), hiddenSection]));
		expect(html).not.toContain("Weg");
		expect(html).not.toContain("Ook weg");
		expect(html).toContain("Blijft");
	});

	it("gives a fixed width room to give way, and clips when asked", () => {
		const block = { ...text("Dag"), alignSelf: "center", box: { ...emptyBox(), width: 240, minHeight: 80, clip: true } } as MailBlock;
		const html = compileLayout(layoutWith([sectionWith([block])]));
		expect(html).toContain("width:240px;max-width:100%;box-sizing:border-box");
		expect(html).toContain("min-height:80px");
		expect(html).toContain("overflow:hidden");
		expect(html).toContain("align-self:center");
		const back = layoutFromHtml(html).sections[0]?.blocks[0];
		expect(back?.alignSelf).toBe("center");
		expect(back && "box" in back ? [back.box.width, back.box.minHeight, back.box.clip] : null).toEqual([240, 80, true]);
	});

	it("reads a block stored before these fields existed as visible and placed by its section", () => {
		const layout = normaliseLayout({
			version: 1,
			sections: [{ id: "s1", name: "Body", blocks: [{ id: "b1", kind: "text", html: "Dag" }] }],
		});
		const block = layout?.sections[0]?.blocks[0];
		expect(block?.hidden).toBe(false);
		expect(block?.alignSelf).toBe("auto");
		expect(layout?.sections[0]?.hidden).toBe(false);
		expect(layout?.fonts).toEqual([]);
	});
});

describe("code blocks", () => {
	function code(html: string, css = ""): MailBlock {
		return { id: "c1", kind: "html", html, css, grow: 0, alignSelf: "auto", hidden: false };
	}

	it("keeps an email's structure and drops everything that runs", () => {
		const out = sanitiseMarkup(
			'<!-- note --><table role="presentation" width="600" cellpadding="0"><tr><td align="center" bgcolor="#ffffff" onclick="x()">' +
				'<h2 style="color:#16161d;position:absolute">Dag</h2>' +
				'<img src="https://example.be/a.png" alt="Logo" width="120">' +
				'<img src="http://example.be/b.png">' +
				'<a href="javascript:alert(1)">weg</a>' +
				"<script>alert(1)</script><style>p{color:red}</style>" +
				"</td></tr></table>",
		);
		// Attributes come back in the sanitiser's own order, each one checked.
		expect(out).toContain('<table width="600" cellpadding="0" role="presentation">');
		expect(out).toContain('<td align="center" bgcolor="#ffffff">');
		expect(out).toContain('<h2 style="color:#16161d">Dag</h2>');
		expect(out).toContain('<img src="https://example.be/a.png" alt="Logo" width="120">');
		// An http picture keeps its tag and loses its address.
		expect(out).toContain('<img alt="">');
		expect(out).toContain("<a>weg</a>");
		expect(out).not.toContain("script");
		expect(out).not.toContain("color:red");
		expect(out).not.toContain("note");
		expect(out).not.toContain("onclick");
	});

	it("unwraps a whole pasted document and escapes a tag it does not know", () => {
		const out = sanitiseMarkup("<html><body><p>Dag</p><video>x</video></body></html>");
		expect(out).toBe("<p>Dag</p>&lt;video&gt;x&lt;/video&gt;");
	});

	it("puts the CSS on the element when the code is one element", () => {
		const html = compileLayout(layoutWith([sectionWith([code('<h2 style="margin:0">Dag</h2>', "color:#4a3fa0")])]));
		expect(html).toContain('<h2 data-juno-block="html" data-juno-id="c1" style="margin:0;color:#4a3fa0">Dag</h2>');
	});

	it("puts the CSS on a div around the code when it is more than one element", () => {
		const html = compileLayout(layoutWith([sectionWith([code("<p>Een</p><p>Twee</p>", "padding:8px")])]));
		expect(html).toContain('<div data-juno-block="html" data-juno-id="c1" data-juno-wrap="1" style="padding:8px"><p>Een</p><p>Twee</p></div>');
	});

	it("converts a block without changing a single byte of what it compiles to", () => {
		const heading = {
			...newBlock("heading"),
			id: "h1",
			grow: 1,
			alignSelf: "center",
			box: { ...emptyBox(), fill: { kind: "solid" as const, color: "#f6f6fa" }, borderRadius: 6 },
		} as MailBlock;
		const before = layoutWith([sectionWith([heading])]);
		const after = convertBlockToCode(before, before.sections[0]!.id, "h1", []);
		const converted = after.sections[0]?.blocks[0];
		expect(converted?.kind).toBe("html");
		// The placement is part of the code now, so the block carries none of its own.
		expect(converted?.grow).toBe(0);
		expect(converted?.alignSelf).toBe("auto");
		expect(compileLayout(after)).toBe(compileLayout(before).replace('data-juno-block="heading"', 'data-juno-block="html"'));
	});

	it("keeps a hidden block hidden when it is converted", () => {
		const hidden = { ...newBlock("text"), id: "t9", hidden: true } as MailBlock;
		const layout = layoutWith([sectionWith([hidden])]);
		expect(convertBlockToCode(layout, layout.sections[0]!.id, "t9", []).sections[0]?.blocks[0]?.hidden).toBe(true);
		expect(blockToCode(hidden, [], []).html).toBe("<div>Tekst</div>");
	});

	it("reads a code block back as the code it was", () => {
		const layout = layoutWith([
			sectionWith([code('<p style="margin:0">Een</p>', "color:#16161d"), { ...code("<b>A</b> en <i>B</i>", "padding:4px"), id: "c2" }]),
		]);
		const html = compileLayout(layout);
		const back = layoutFromHtml(html);
		expect(back.sections[0]?.blocks).toMatchObject([
			{ kind: "html", html: "<p>Een</p>", css: "margin:0;color:#16161d" },
			{ kind: "html", html: "<b>A</b> en <i>B</i>", css: "padding:4px" },
		]);
		expect(compileLayout(back)).toBe(html);
	});

	it("loads a raw block from before blocks were code without moving it", () => {
		const layout = normaliseLayout({
			version: 1,
			sections: [
				{
					id: "s1",
					name: "Body",
					blocks: [
						{ id: "r1", kind: "html", html: "Dag <b>Jan</b>", box: { padding: { top: 8, right: 8, bottom: 8, left: 8 } } },
						{ id: "r2", kind: "html", html: "<p>Los</p>" },
					],
				},
			],
		});
		expect(layout?.sections[0]?.blocks).toMatchObject([
			{ kind: "html", html: "<div>Dag <b>Jan</b></div>", css: "padding:8px 8px 8px 8px" },
			{ kind: "html", html: "<p>Los</p>", css: "" },
		]);
	});
});
