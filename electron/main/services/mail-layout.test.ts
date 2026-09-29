import { describe, expect, it } from "vitest";
import type { MailBlock, MailContainer, MailFont, MailLayout, MailNode, MailTextStyle, TemplateInput } from "../../shared/types";
import {
	blockToCode,
	breakpointCss,
	compileLayout,
	layoutAt,
	convertNodeToCode,
	fontLinks,
	sanitiseMarkup,
	googleFontHref,
	safeStylesheetHref,
	toFamily,
	emptyBox,
	emptyLayout,
	emptyContainer,
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

function sectionWith(children: MailBlock[], layout?: Partial<MailContainer["layout"]>): MailContainer {
	const section = emptyContainer("section", "Body");
	section.children = children;
	if (layout) section.layout = { ...section.layout, ...layout } as MailContainer["layout"];
	return section;
}

function layoutWith(children: MailContainer[]): MailLayout {
	return { ...emptyLayout(), children };
}

function text(html: string): MailBlock {
	return { id: "t1", kind: "text", tag: "p", html, text: defaultText(), box: emptyBox(), grow: 0, alignSelf: "auto", hidden: false };
}

/** The children of a container, narrowed for tests that already know they hold only blocks. */
function blocksOf(node: { children: unknown } | undefined): MailBlock[] {
	return ((node?.children as MailBlock[] | undefined) ?? []) as MailBlock[];
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

	it("gives a layout with nothing in it one container to start from", () => {
		const layout = normaliseLayout({ version: 2, children: [] });
		expect(layout?.children).toHaveLength(1);
	});

	it("gives a version 1 layout with no sections one to start from", () => {
		const layout = normaliseLayout({ version: 1, sections: [] });
		expect(layout?.children).toHaveLength(1);
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
		const layout: MailLayout = { ...emptyLayout(), widthMode: "fixed", width: 640, minHeight: 500 };
		const html = compileLayout(layout);
		expect(html).toContain("max-width:640px;margin:0 auto");
		expect(html).toContain("min-height:500px");
	});

	it("fills the mail client with a new canvas, whatever width it is drawn at", () => {
		const html = compileLayout({ ...emptyLayout(), width: 640 });
		expect(html).toContain('style="width:100%');
		expect(html).not.toContain("max-width:640px");
		// The width it is drawn at is not in the markup, so it comes back from the canvas it came from.
		const back = layoutFromHtml(html, { ...emptyLayout(), width: 640 });
		expect(back.widthMode).toBe("fill");
		expect(back.width).toBe(640);
	});

	it("keeps a canvas saved before the choice existed at the width it was sent at", () => {
		const layout = normaliseLayout({ version: 1, width: 600, sections: [] });
		expect(layout?.widthMode).toBe("fixed");
	});

	it("renders an image input as a picture and a text input as its token", () => {
		const inputs: TemplateInput[] = [
			{ key: "banner", label: "Banner", kind: "image", required: false },
			{ key: "scope", label: "Scope", kind: "text", required: false },
		];
		const blocks: MailBlock[] = [
			{ id: "f1", kind: "field", inputKey: "banner", text: defaultText(), box: emptyBox(), grow: 0, alignSelf: "auto", hidden: false },
			{ id: "f2", kind: "field", inputKey: "scope", text: defaultText(), box: emptyBox(), grow: 0, alignSelf: "auto", hidden: false },
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
						tag: "h2",
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
			'<section data-juno-section="Body" data-juno-id="s1" style="display:block;display:flex">' +
			'<div data-juno-block="text" data-juno-id="t1">Dag</div>' +
			"<table><tr><td>Met de hand</td></tr></table>" +
			"</section></div>";
		const readBack = layoutFromHtml(html);
		const kinds = readBack.children.flatMap((section) => blocksOf(section).map((block) => block.kind));
		expect(kinds).toContain("html");
		expect(JSON.stringify(readBack)).toContain("Met de hand");
	});

	it("turns markup with no canvas marker into one section holding all of it", () => {
		const readBack = layoutFromHtml("<p>Zomaar getypt</p>");
		expect(readBack.children).toHaveLength(1);
		expect(blocksOf(readBack.children[0])[0]?.kind).toBe("html");
		expect(JSON.stringify(readBack)).toContain("Zomaar getypt");
	});

	it("reads a grid section back as a grid", () => {
		const html = compileLayout(
			layoutWith([sectionWith([text("a")], { kind: "grid", columns: 4, gap: 10, align: "center" })]),
		);
		const section = layoutFromHtml(html).children[0] as MailContainer;
		expect(section.layout).toEqual({ kind: "grid", columns: 4, gap: 10, align: "center" });
	});

	it("hands an author's own declarations back to the custom CSS field", () => {
		const layout = emptyLayout();
		(layout.children[0] as MailContainer).box.customCss = "text-transform:uppercase";
		const html = compileLayout(normaliseLayout(layout)!);
		expect((layoutFromHtml(html).children[0] as MailContainer).box.customCss).toBe("text-transform:uppercase");
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

	it("keeps li only when it is told to, for a list block's items", () => {
		expect(sanitiseFragment("<li>Een</li>")).toBe("&lt;li&gt;Een&lt;/li&gt;");
		expect(sanitiseFragment("<li>Een</li>", ["li"])).toBe("<li>Een</li>");
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
			fill: { kind: "gradient", angle: 45, from: "#ffffff", to: "#4a3fa0", hidden: false },
			borderWidth: 1,
			borderColor: "#e3e2ec",
			borderStyle: "dotted",
			borderRadius: 6,
			opacity: 0.8,
			effects: [
				{ kind: "shadow", inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "#16161d", opacity: 0.2, hidden: false },
			],
		});
		const back = layoutFromHtml(compileLayout(layout));
		const box = blocksOf(back.children[0])[0]?.box;
		expect(box?.fill).toEqual({ kind: "gradient", angle: 45, from: "#ffffff", to: "#4a3fa0", hidden: false });
		expect(box?.borderStyle).toBe("dotted");
		expect(box?.borderRadius).toBe(6);
		expect(box?.opacity).toBe(0.8);
		expect(box?.effects).toEqual([
			{ kind: "shadow", inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "#16161d", opacity: 0.2, hidden: false },
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
		expect(layout?.fill).toEqual({ kind: "solid", color: "#f6f6fa", hidden: false });
		expect(blocksOf(layout?.children[0])[0]?.box.fill).toEqual({ kind: "solid", color: "#ffffff", hidden: false });
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
		const back = blocksOf(layoutFromHtml(html).children[0])[0];
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
		const back = blocksOf(layoutFromHtml(typed(style)).children[0])[0];
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
		const back = blocksOf(layoutFromHtml(html).children[0])[0];
		expect(back?.alignSelf).toBe("center");
		expect(back && "box" in back ? [back.box.width, back.box.minHeight, back.box.clip] : null).toEqual([240, 80, true]);
	});

	it("reads a block stored before these fields existed as visible and placed by its section", () => {
		const layout = normaliseLayout({
			version: 1,
			sections: [{ id: "s1", name: "Body", blocks: [{ id: "b1", kind: "text", html: "Dag" }] }],
		});
		const block = blocksOf(layout?.children[0])[0];
		expect(block?.hidden).toBe(false);
		expect(block?.alignSelf).toBe("auto");
		expect((layout?.children[0] as MailContainer)?.hidden).toBe(false);
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
		const after = convertNodeToCode(before, (before.children[0] as MailContainer).id, "h1", []);
		const converted = blocksOf(after.children[0])[0];
		expect(converted?.kind).toBe("html");
		// The placement is part of the code now, so the block carries none of its own.
		expect(converted?.grow).toBe(0);
		expect(converted?.alignSelf).toBe("auto");
		expect(compileLayout(after)).toBe(compileLayout(before).replace('data-juno-block="heading"', 'data-juno-block="html"'));
	});

	it("keeps a hidden block hidden when it is converted", () => {
		const hidden = { ...newBlock("text"), id: "t9", hidden: true } as MailBlock;
		const layout = layoutWith([sectionWith([hidden])]);
		const converted = convertNodeToCode(layout, (layout.children[0] as MailContainer).id, "t9", []);
		expect(blocksOf(converted.children[0])[0]?.hidden).toBe(true);
		expect(blockToCode(hidden, [], []).html).toBe("<p>Tekst</p>");
	});

	it("reads a code block back as the code it was", () => {
		const layout = layoutWith([
			sectionWith([code('<p style="margin:0">Een</p>', "color:#16161d"), { ...code("<b>A</b> en <i>B</i>", "padding:4px"), id: "c2" }]),
		]);
		const html = compileLayout(layout);
		const back = layoutFromHtml(html);
		expect(blocksOf(back.children[0])).toMatchObject([
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
		expect(blocksOf(layout?.children[0])).toMatchObject([
			{ kind: "html", html: "<div>Dag <b>Jan</b></div>", css: "padding:8px 8px 8px 8px" },
			{ kind: "html", html: "<p>Los</p>", css: "" },
		]);
	});
});

describe("colours with an opacity", () => {
	function boxed(box: Partial<MailBlock["box"] & object>): MailLayout {
		return layoutWith([sectionWith([{ ...text("Dag"), box: { ...emptyBox(), ...box } }])]);
	}

	it("takes eight digits and keeps a whole opacity as six", () => {
		expect(toColor("#4a3fa080")).toBe("#4a3fa080");
		expect(toColor("#4a3fa0ff")).toBe("#4a3fa0");
		expect(toColor("#4a3fa0f")).toBeNull();
	});

	it("writes the colour solid first, for a client that cannot read rgba", () => {
		const html = compileLayout(boxed({ fill: { kind: "solid", color: "#4a3fa080", hidden: false } }));
		expect(html).toContain("background-color:#4a3fa0;background-color:rgba(74,63,160,0.502)");
	});

	it("carries a colour's opacity through a compile and a read back", () => {
		const layout = layoutWith([
			sectionWith([
				{
					...text("Dag"),
					text: { ...defaultText(), color: "#16161d80" },
					box: {
						...emptyBox(),
						fill: { kind: "gradient", angle: 90, from: "#ffffff00", to: "#4a3fa0cc", hidden: false },
						borderWidth: 2,
						borderColor: "#e3e2ec40",
					},
				},
			]),
		]);
		const html = compileLayout(layout);
		const block = blocksOf(layoutFromHtml(html).children[0])[0];
		expect(block?.kind === "text" ? block.text.color : null).toBe("#16161d80");
		expect(block?.box).toMatchObject({
			fill: { kind: "gradient", angle: 90, from: "#ffffff00", to: "#4a3fa0cc" },
			borderColor: "#e3e2ec40",
			borderWidth: 2,
		});
		expect(compileLayout(layoutFromHtml(html))).toBe(html);
	});
});

describe("fills, strokes and effects with an eye", () => {
	function boxed(box: Partial<MailBlock["box"] & object>): MailLayout {
		return layoutWith([sectionWith([{ ...text("Dag"), box: { ...emptyBox(), ...box } }])]);
	}

	it("leaves a hidden fill, a hidden stroke and a hidden effect out of the message", () => {
		const html = compileLayout(
			boxed({
				fill: { kind: "solid", color: "#4a3fa0", hidden: true },
				borderWidth: 1,
				borderColor: "#e3e2ec",
				strokeHidden: true,
				effects: [{ kind: "blur", radius: 4, hidden: true }],
			}),
		);
		expect(html).not.toContain("background-color");
		expect(html).not.toContain("border:");
		expect(html).not.toContain("blur(");
	});

	it("draws a stroke on the sides it is on, and reads them back", () => {
		const layout = boxed({
			borderWidth: 1,
			borderColor: "#e3e2ec",
			borderSides: { top: false, right: false, bottom: true, left: false },
		});
		const html = compileLayout(layout);
		expect(html).toContain("border-bottom:1px solid #e3e2ec");
		expect(html).not.toContain("border:1px");
		const box = blocksOf(layoutFromHtml(html).children[0])[0]?.box;
		expect(box?.borderSides).toEqual({ top: false, right: false, bottom: true, left: false });
		expect(box?.customCss).toBeNull();
	});

	it("measures a fixed height the way Figma does, padding included", () => {
		const html = compileLayout(boxed({ minHeight: 1, padding: { top: 0, right: 0, bottom: 0, left: 0 } }));
		expect(html).toContain("box-sizing:border-box;min-height:1px");
	});
});

describe("text and sections", () => {
	it("writes a text block as a paragraph, unless its own markup has paragraphs", () => {
		expect(compileLayout(layoutWith([sectionWith([text("Dag")])]))).toContain('<p data-juno-block="text"');
		expect(compileLayout(layoutWith([sectionWith([text("<p>Een</p><p>Twee</p>")])]))).toContain(
			'<div data-juno-block="text"',
		);
	});

	it("reads a paragraph back as the text block it was", () => {
		const html = compileLayout(layoutWith([sectionWith([text("Dag <b>jij</b>")])]));
		const block = blocksOf(layoutFromHtml(html).children[0])[0];
		expect(block?.kind === "text" ? block.html : null).toBe("Dag <b>jij</b>");
	});

	it("puts a section narrower than the frame in the middle with margins, and reads it back", () => {
		const section = { ...sectionWith([]), alignSelf: "center" as const, box: { ...emptyBox(), width: 400 } };
		const html = compileLayout(layoutWith([section]));
		expect(html).toContain("margin-left:auto;margin-right:auto");
		const back = layoutFromHtml(html).children[0] as MailContainer;
		expect(back?.alignSelf).toBe("center");
		expect(back?.box.customCss).toBeNull();
	});
});

describe("breakpoints", () => {
	function withBreakpoints(): MailLayout {
		const block = { ...text("Dag"), id: "t1", text: { ...defaultText(), fontSize: 18 } };
		const section = { ...sectionWith([block], { direction: "row" }), id: "s1" };
		return {
			...layoutWith([section]),
			breakpoints: [
				{
					id: "phone",
					name: "Phone",
					maxWidth: 320,
					sections: {},
					blocks: { t1: { text: { fontSize: 18 } } },
				},
				{
					id: "tablet",
					name: "Tablet",
					maxWidth: 480,
					sections: { s1: { layout: { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false } } },
					blocks: { t1: { text: { fontSize: 14 } } },
				},
			],
		};
	}

	it("writes each breakpoint as a media query, widest first, with only what it changes", () => {
		const layout = withBreakpoints();
		const css = breakpointCss(layout);
		const tablet = css.indexOf("max-width:480px");
		const phone = css.indexOf("max-width:320px");
		expect(tablet).toBeGreaterThanOrEqual(0);
		expect(phone).toBeGreaterThan(tablet);
		expect(css).toContain(".jb-s1{flex-direction:column !important}");
		expect(css).toContain(".jb-t1{font-size:14px !important}");
		// The phone puts back the size the tablet changed, which is only a
		// change against the tablet, not against the default.
		expect(css.slice(phone)).toContain(".jb-t1{font-size:18px !important}");
		const html = compileLayout(layout);
		expect(html).toContain('data-juno-id="s1" class="jb-s1"');
		expect(html).toContain('data-juno-id="t1" class="jb-t1"');
	});

	it("draws a breakpoint on the canvas the way the queries stack", () => {
		const layout = withBreakpoints();
		const tablet = layoutAt(layout, "tablet");
		const phone = layoutAt(layout, "phone");
		expect(tablet.width).toBe(480);
		expect(phone.width).toBe(320);
		const at = (shown: MailLayout) => {
			const block = blocksOf(shown.children[0])[0];
			return block?.kind === "text" ? block.text.fontSize : null;
		};
		expect(at(tablet)).toBe(14);
		expect(at(phone)).toBe(18);
		// The phone inherits the tablet's column.
		const section = (phone.children[0] as MailContainer)?.layout;
		expect(section?.kind === "flex" ? section.direction : null).toBe("column");
	});

	it("resets what a breakpoint takes away, because an inline style only gives way to !important", () => {
		const block = { ...text("Dag"), id: "t1", grow: 1 };
		const layout: MailLayout = {
			...layoutWith([{ ...sectionWith([block]), id: "s1" }]),
			breakpoints: [{ id: "b", name: "Phone", maxWidth: 480, sections: {}, blocks: { t1: { grow: 0 } } }],
		};
		expect(breakpointCss(layout)).toContain(".jb-t1{flex:0 1 auto !important}");
	});

	it("hides a block at a breakpoint, and shows one there that is hidden by default", () => {
		const shown = { ...text("Mobiel"), id: "m1", hidden: true };
		const gone = { ...text("Groot"), id: "g1" };
		const layout: MailLayout = {
			...layoutWith([{ ...sectionWith([shown, gone]), id: "s1" }]),
			breakpoints: [
				{ id: "b", name: "Phone", maxWidth: 480, sections: {}, blocks: { m1: { hidden: false }, g1: { hidden: true } } },
			],
		};
		const html = compileLayout(layout);
		expect(html).toContain('data-juno-id="m1" class="jb-m1" style="margin:0;display:none;mso-hide:all"');
		const css = breakpointCss(layout);
		expect(css).toContain(".jb-m1{display:block !important}");
		expect(css).toContain(".jb-g1{display:none !important}");
		// Hidden everywhere is still left out entirely.
		const nowhere: MailLayout = { ...layout, breakpoints: [] };
		expect(compileLayout(nowhere)).not.toContain("Mobiel");
		// And the reader knows the two declarations for what they are.
		const back = blocksOf(layoutFromHtml(html, layout).children[0])[0];
		expect(back?.hidden).toBe(true);
		expect(back?.box.customCss).toBeNull();
	});

	it("keeps only real changes to things that are there, whatever it is handed", () => {
		const layout = normaliseLayout({
			version: 1,
			sections: [{ id: "s1", name: "Body", blocks: [{ id: "t1", kind: "text", html: "Dag" }] }],
			breakpoints: [
				{
					id: "b",
					name: "Phone",
					maxWidth: 480,
					sections: { s1: { box: { padding: { top: 8, right: 8, bottom: 8, left: 8 }, position: "fixed" } } },
					// Parsed, because an object literal would set the prototype rather
					// than name an entry, which is not what arrives over the bridge.
					blocks: JSON.parse(
						'{"t1":{"text":{"fontSize":14,"color":"red;position:fixed"},"href":"javascript:alert(1)"},"gone":{"hidden":true},"__proto__":{"hidden":true}}',
					),
				},
			],
		});
		const breakpoint = layout?.breakpoints[0];
		expect(breakpoint?.sections.s1).toEqual({ box: { padding: { top: 8, right: 8, bottom: 8, left: 8 } } });
		expect(breakpoint?.blocks.t1).toEqual({ text: { fontSize: 14, color: null } });
		expect(Object.keys(breakpoint?.blocks ?? {})).toEqual(["t1"]);
	});

	it("keeps a class name to letters, whatever the id holds", () => {
		const block = { ...text("Dag"), id: "a}b<c{d" };
		const layout: MailLayout = {
			...layoutWith([sectionWith([block])]),
			breakpoints: [{ id: "b", name: "Phone", maxWidth: 480, sections: {}, blocks: { "a}b<c{d": { hidden: true } } }],
		};
		expect(breakpointCss(layout)).toContain(".jb-abcd{display:none !important}");
		expect(compileLayout(layout)).toContain('class="jb-abcd"');
	});

	it("carries the breakpoints through the code view, for what is still there", () => {
		const layout = withBreakpoints();
		const html = compileLayout(layout);
		const back = layoutFromHtml(html, layout);
		expect(back.breakpoints.map((breakpoint) => breakpoint.id)).toEqual(["phone", "tablet"]);
		expect(back.breakpoints[1]?.blocks.t1).toEqual({ text: { fontSize: 14 } });
		const emptied = layoutFromHtml(html.replace(/<p data-juno-block="text"[^>]*>Dag<\/p>/, ""), layout);
		expect(emptied.breakpoints[1]?.blocks.t1).toBeUndefined();
	});

	it("keeps whether a converted block shows at a breakpoint, and drops its style there", () => {
		const layout: MailLayout = {
			...withBreakpoints(),
			breakpoints: [{ id: "b", name: "Phone", maxWidth: 480, sections: {}, blocks: { t1: { hidden: true, text: { fontSize: 12 } } } }],
		};
		const converted = convertNodeToCode(layout, "s1", "t1", []);
		expect(converted.breakpoints[0]?.blocks.t1).toEqual({ hidden: true });
	});

	it("changes a breakpoint on a nested container's own style, and on a block inside it", () => {
		const inner = { ...text("Diep"), id: "deep" };
		const nested: MailContainer = { ...emptyContainer("div", "Inner"), id: "inner", children: [inner] };
		const outer: MailContainer = { ...sectionWith([nested]), id: "outer" };
		const layout: MailLayout = {
			...layoutWith([outer]),
			breakpoints: [
				{
					id: "b",
					name: "Phone",
					maxWidth: 480,
					sections: { inner: { hidden: true } },
					blocks: { deep: { hidden: true } },
				},
			],
		};
		const drawn = layoutAt(layout, "b");
		const drawnInner = (drawn.children[0] as MailContainer).children[0] as MailContainer;
		expect(drawnInner.hidden).toBe(true);
		expect((drawnInner.children[0] as MailBlock).hidden).toBe(true);
		const css = breakpointCss(layout);
		expect(css).toContain(".jb-inner{display:none !important}");
		expect(css).toContain(".jb-deep{display:none !important}");
	});
});

describe("version migration", () => {
	/**
	 * A version 1 layout with every kind of block, a grid section, and
	 * breakpoints overriding both a section and blocks. Loads unchanged: the
	 * only difference in what it sends is `<section>` instead of `<div>`, with
	 * `display:block` written first, on every section.
	 */
	function v1Fixture(): Record<string, unknown> {
		return {
			version: 1,
			width: 640,
			widthMode: "fixed",
			minHeight: 200,
			fill: { kind: "solid", color: "#f6f6fa" },
			fonts: [],
			customCss: null,
			sections: [
				{
					id: "s1",
					name: "Header",
					hidden: false,
					alignSelf: "auto",
					layout: { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false },
					box: {},
					blocks: [
						{ id: "h1", kind: "heading", level: 1, content: "Welkom", box: {} },
						{ id: "t1", kind: "text", html: "Hallo <b>daar</b>", box: {} },
						{ id: "b1", kind: "button", label: "Ga", href: "https://example.be", background: "#4a3fa0", color: "#ffffff", radius: 4, box: {} },
						{ id: "i1", kind: "image", src: "https://example.be/a.png", alt: "Logo", width: 100, align: "left", box: {} },
						{ id: "d1", kind: "divider", color: "#000000", thickness: 2, box: {} },
						{ id: "sp1", kind: "spacer", height: 20 },
						{ id: "f1", kind: "field", inputKey: "scope", box: {} },
						{ id: "c1", kind: "html", html: "<p>Code</p>", css: "color:red" },
					],
				},
				{
					id: "s2",
					name: "Footer",
					hidden: false,
					alignSelf: "auto",
					layout: { kind: "grid", columns: 2, gap: 8, align: "stretch" },
					box: {},
					blocks: [{ id: "t2", kind: "text", html: "Tweede" }],
				},
			],
			breakpoints: [
				{
					id: "bp1",
					name: "Phone",
					maxWidth: 480,
					sections: { s2: { box: { padding: { top: 4, right: 4, bottom: 4, left: 4 } } } },
					blocks: { h1: { grow: 1 }, t2: { hidden: true } },
				},
			],
		};
	}

	it("loads a version 1 layout with every ids and shape kept", () => {
		const normalised = normaliseLayout(v1Fixture())!;
		expect(normalised.version).toBe(2);
		expect(normalised.children.map((node) => node.id)).toEqual(["s1", "s2"]);
		for (const node of normalised.children) {
			expect(node.kind).toBe("container");
			expect((node as MailContainer).tag).toBe("section");
			expect((node as MailContainer).grow).toBe(0);
		}
		expect(blocksOf(normalised.children[0]).map((block) => block.id)).toEqual([
			"h1",
			"t1",
			"b1",
			"i1",
			"d1",
			"sp1",
			"f1",
			"c1",
		]);
		const heading = blocksOf(normalised.children[0])[0];
		expect(heading?.kind === "heading" ? heading.tag : null).toBe("h1");
		const paragraph = blocksOf(normalised.children[0])[1];
		expect(paragraph?.kind === "text" ? paragraph.tag : null).toBe("p");
		const picture = blocksOf(normalised.children[0])[3];
		expect(picture?.kind === "image" ? picture.href : "not image").toBeNull();
	});

	it("sends the same body as before, except a section is a <section> with display:block first", () => {
		const normalised = normaliseLayout(v1Fixture())!;
		const v2Html = compileLayout(normalised);

		// The same tree, with every section's tag forced back to "div": that is
		// exactly what a version 1 layout always compiled to, since every
		// section was a div and never carried `display:block`.
		const asV1Would = {
			...normalised,
			children: normalised.children.map((node) => ({ ...(node as MailContainer), tag: "div" as const })),
		};
		const oldEquivalentHtml = compileLayout(asV1Would);

		const reverted = v2Html
			.replace(/<section(\s+data-juno-section=)/g, "<div$1")
			.replace(/<\/section>/g, "</div>")
			.replace(/style="display:block;(display:(?:flex|grid))/g, 'style="$1');
		expect(reverted).toBe(oldEquivalentHtml);
		// Proof the substitution actually did something, so the test cannot pass
		// by the two sides already being identical.
		expect(v2Html).not.toBe(oldEquivalentHtml);
		expect(v2Html).toContain("<section ");
		expect(v2Html).toContain("style=\"display:block;display:flex");

		// The breakpoint CSS does not depend on the tag at all.
		expect(breakpointCss(normalised)).toBe(breakpointCss(asV1Would));
	});

	it("compiles a version 1 layout to the body version 1 sent, with only the sections changed", () => {
		// Captured from the version 1 compiler, with each section's
		// `<div ... style="` turned into `<section ... style="display:block;`.
		// A change here is a change to what every existing template sends.
		const inputs: TemplateInput[] = [{ key: "scope", label: "Scope", kind: "text", required: false }];
		const expected =
			'<div data-juno-canvas="1" style="max-width:640px;margin:0 auto;min-height:200px;background-color:#f6f6fa">' +
			'<section data-juno-section="Header" data-juno-id="s1" style="display:block;display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;gap:12px;flex-wrap:nowrap">' +
			'<h1 data-juno-block="heading" data-juno-id="h1" class="jb-h1" style="margin:0;font-weight:400">Welkom</h1>' +
			'<p data-juno-block="text" data-juno-id="t1" style="margin:0">Hallo <b>daar</b></p>' +
			'<a data-juno-block="button" data-juno-id="b1" href="https://example.be" style="display:inline-block;text-decoration:none;background:#4a3fa0;color:#ffffff;font-weight:600;border-radius:4px;padding:10px 18px">Ga</a>' +
			'<img data-juno-block="image" data-juno-id="i1" src="https://example.be/a.png" alt="Logo" style="display:block;max-width:100%;width:100px;height:auto">' +
			'<hr data-juno-block="divider" data-juno-id="d1" style="border:0;border-top:2px solid #000000;width:100%">' +
			'<div data-juno-block="spacer" data-juno-id="sp1" style="height:20px;line-height:0;font-size:0">&nbsp;</div>' +
			'<span data-juno-block="field" data-juno-id="f1" data-juno-field="scope">{{document.scope}}</span>' +
			'<p data-juno-block="html" data-juno-id="c1" style="color:red">Code</p>' +
			"</section>" +
			'<section data-juno-section="Footer" data-juno-id="s2" class="jb-s2" style="display:block;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;align-items:stretch">' +
			'<p data-juno-block="text" data-juno-id="t2" class="jb-t2" style="margin:0">Tweede</p>' +
			"</section></div>";
		expect(compileLayout(normaliseLayout(v1Fixture())!, inputs)).toBe(expected);
	});
});

describe("containers", () => {
	it("writes every container tag as itself, div excepted, and reads it back", () => {
		const tags = ["section", "div", "header", "footer", "main", "article", "aside", "nav"] as const;
		for (const tag of tags) {
			const container: MailContainer = { ...emptyContainer(tag, "Node"), id: `c-${tag}`, children: [text("Dag")] };
			const html = compileLayout(layoutWith([container]));
			if (tag === "div") {
				expect(html).not.toContain("display:block;display:flex");
				expect(html).toContain(`<div data-juno-section="Node" data-juno-id="c-${tag}"`);
			} else {
				expect(html).toContain(`<${tag} data-juno-section="Node" data-juno-id="c-${tag}" style="display:block;display:flex`);
			}
			const back = layoutFromHtml(html).children[0] as MailContainer;
			expect(back.tag).toBe(tag);
		}
	});

	it("nests a container inside another, and reads the nesting back", () => {
		const inner: MailContainer = { ...emptyContainer("div", "Inner"), id: "inner", children: [{ ...text("Diep"), id: "t2" }] };
		const outer: MailContainer = {
			...emptyContainer("header", "Outer"),
			id: "outer",
			children: [{ ...text("Boven"), id: "t1" }, inner],
		};
		const html = compileLayout(layoutWith([outer]));
		expect(html).toContain('<header data-juno-section="Outer" data-juno-id="outer"');
		expect(html).toContain('<div data-juno-section="Inner" data-juno-id="inner"');

		const back = layoutFromHtml(html).children[0] as MailContainer;
		expect(back.tag).toBe("header");
		expect(back.children).toHaveLength(2);
		const backInner = back.children[1] as MailContainer;
		expect(backInner.kind).toBe("container");
		expect(backInner.tag).toBe("div");
		expect(blocksOf(backInner)[0]?.kind === "text" ? blocksOf(backInner)[0]?.html : null).toBe("Diep");
		expect(compileLayout(layoutFromHtml(html))).toBe(html);
	});

	it("refuses a container nested past the depth limit rather than keeping it", () => {
		let node: Record<string, unknown> = { id: "leaf", kind: "container", tag: "div", name: "Leaf", children: [] };
		for (let depth = 0; depth < 12; depth++) {
			node = { id: `n${depth}`, kind: "container", tag: "div", name: "Node", children: [node] };
		}
		const normalised = normaliseLayout({ version: 2, children: [node] });
		let depth = 0;
		let current = normalised?.children[0] as MailContainer | undefined;
		while (current?.kind === "container" && current.children[0]) {
			current = current.children[0] as MailContainer;
			depth++;
		}
		expect(depth).toBeLessThanOrEqual(8);
	});
});

describe("columns", () => {
	it("compiles a table with two cells, each holding a block, and reads it back", () => {
		const layout: MailLayout = {
			...emptyLayout(),
			children: [
				{
					id: "cols",
					kind: "columns",
					hidden: false,
					name: "Vergelijk",
					alignSelf: "auto",
					grow: 0,
					gap: 16,
					box: emptyBox(),
					rows: [
						{
							id: "row1",
							cells: [
								{ id: "cell1", width: 50, verticalAlign: "top", box: emptyBox(), children: [{ ...text("Links"), id: "l1" }] },
								{ id: "cell2", width: 50, verticalAlign: "middle", box: emptyBox(), children: [{ ...text("Rechts"), id: "r1" }] },
							],
						},
					],
				},
			],
		};
		const html = compileLayout(layout);
		expect(html).toContain('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" data-juno-columns="Vergelijk" data-juno-id="cols"');
		expect(html).toContain('<tr data-juno-id="row1">');
		expect(html).toContain('<td data-juno-id="cell1" width="50%" valign="top"');
		expect(html).toContain('<td data-juno-id="cell2" width="50%" valign="middle"');
		expect(html).toContain("Links");
		expect(html).toContain("Rechts");

		const back = layoutFromHtml(html).children[0];
		expect(back?.kind).toBe("columns");
		if (back?.kind !== "columns") throw new Error("not columns");
		expect(back.rows).toHaveLength(1);
		expect(back.rows[0]?.cells).toHaveLength(2);
		expect(back.rows[0]?.cells[0]?.width).toBe(50);
		expect(back.rows[0]?.cells[1]?.verticalAlign).toBe("middle");
		const leftBlock = back.rows[0]?.cells[0]?.children[0];
		expect(leftBlock?.kind === "text" ? leftBlock.html : null).toBe("Links");
	});

	it("splits the gap between cells and leaves the outer edges alone", () => {
		const layout: MailLayout = {
			...emptyLayout(),
			children: [
				{
					id: "cols",
					kind: "columns",
					hidden: false,
					name: "Cols",
					alignSelf: "auto",
					grow: 0,
					gap: 20,
					box: emptyBox(),
					rows: [
						{
							id: "row1",
							cells: [
								{ id: "cell1", width: null, verticalAlign: "top", box: emptyBox(), children: [] },
								{ id: "cell2", width: null, verticalAlign: "top", box: emptyBox(), children: [] },
							],
						},
					],
				},
			],
		};
		const html = compileLayout(layout);
		expect(html).toContain('<td data-juno-id="cell1" valign="top" style="vertical-align:top;padding-right:10px">');
		expect(html).toContain('<td data-juno-id="cell2" valign="top" style="vertical-align:top;padding-left:10px">');
	});
});

describe("text tags", () => {
	it("keeps a list's bullets inside its box, unless the box sets its own padding", () => {
		const list: MailBlock = { ...newBlock("text"), id: "l1", tag: "ul", html: "<li>Een</li>" } as MailBlock;
		const bare = compileLayout(layoutWith([sectionWith([list])]));
		expect(bare).toMatch(/<ul[^>]*style="margin:0;padding-left:24px/);
		const padded = compileLayout(
			layoutWith([sectionWith([{ ...list, box: { ...list.box, padding: { top: 0, right: 0, bottom: 0, left: 8 } } } as MailBlock])]),
		);
		expect(padded).toMatch(/<ul[^>]*style="[^"]*padding-left:24px[^"]*padding:0px 0px 0px 8px/);
	});

	it("writes every text tag as itself, and reads it back", () => {
		const tags = ["p", "blockquote", "pre", "address", "span"] as const;
		for (const tag of tags) {
			const block = { ...text("Woord"), id: `t-${tag}`, tag };
			const html = compileLayout(layoutWith([sectionWith([block])]));
			expect(html).toContain(`<${tag} data-juno-block="text" data-juno-id="t-${tag}"`);
			const back = blocksOf(layoutFromHtml(html).children[0])[0];
			expect(back?.kind === "text" ? back.tag : null).toBe(tag);
		}
	});

	it("writes a list's html as its li items, inside the ul or ol, and reads it back", () => {
		for (const tag of ["ul", "ol"] as const) {
			const block = { ...text("<li>Een</li><li>Twee</li>"), id: `list-${tag}`, tag };
			const html = compileLayout(layoutWith([sectionWith([block])]));
			expect(html).toContain(`<${tag} data-juno-block="text" data-juno-id="list-${tag}"`);
			expect(html).toContain("<li>Een</li><li>Twee</li>");
			const back = blocksOf(layoutFromHtml(html).children[0])[0];
			expect(back?.kind === "text" ? back.tag : null).toBe(tag);
			expect(back?.kind === "text" ? back.html : null).toBe("<li>Een</li><li>Twee</li>");
		}
	});

	it("never lets a list carry anything but li from its own tags", () => {
		const block = { ...text('<li onclick="x()">Een</li><script>alert(1)</script>'), tag: "ul" as const };
		const html = compileLayout(layoutWith([sectionWith([block])]));
		expect(html).toContain("<li>Een</li>");
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("<script>");
	});
});

describe("heading tags", () => {
	it("writes every heading tag as itself, and reads it back", () => {
		const tags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
		for (const tag of tags) {
			const block = { ...(newBlock("heading") as Extract<MailBlock, { kind: "heading" }>), id: `h-${tag}`, tag, content: "Titel" };
			const html = compileLayout(layoutWith([sectionWith([block])]));
			expect(html).toContain(`<${tag} data-juno-block="heading" data-juno-id="h-${tag}"`);
			const back = blocksOf(layoutFromHtml(html).children[0])[0];
			expect(back?.kind === "heading" ? back.tag : null).toBe(tag);
		}
	});
});

describe("a linked picture", () => {
	it("compiles a picture with an href inside a thin link, and reads it back", () => {
		const image = { ...newBlock("image"), id: "pic", src: "https://example.be/a.png", alt: "Logo", href: "https://example.be" } as MailBlock;
		const html = compileLayout(layoutWith([sectionWith([image])]));
		expect(html).toContain('<a href="https://example.be" data-juno-link="1" style="display:inline-block">');
		expect(html).toContain('<img data-juno-block="image" data-juno-id="pic" src="https://example.be/a.png" alt="Logo"');

		const back = blocksOf(layoutFromHtml(html).children[0])[0];
		expect(back?.kind === "image" ? back.href : "not image").toBe("https://example.be");
		expect(back?.kind === "image" ? back.src : null).toBe("https://example.be/a.png");
		expect(compileLayout(layoutFromHtml(html))).toBe(html);
	});

	it("compiles a plain picture with no link at all", () => {
		const image = { ...newBlock("image"), src: "https://example.be/a.png", alt: "Logo" } as MailBlock;
		const html = compileLayout(layoutWith([sectionWith([image])]));
		expect(html).not.toContain("data-juno-link");
		expect(html).not.toContain("<a ");
	});

	it("refuses an unsafe target for the link round a picture", () => {
		const image = { ...newBlock("image"), src: "https://example.be/a.png", href: "javascript:alert(1)" } as MailBlock;
		const html = compileLayout(layoutWith([sectionWith([image])]));
		expect(html).not.toContain("data-juno-link");
		expect(html).not.toContain("javascript");
	});
});

describe("converting a container or columns table to HTML", () => {
	/** What the client sees: the markup with the compiler's own markers taken out. */
	function bare(html: string): string {
		return html.replace(/ data-juno-[a-z-]+="[^"]*"/g, "");
	}

	function header(): MailContainer {
		const heading = { ...(newBlock("heading") as Extract<MailBlock, { kind: "heading" }>), id: "h3", tag: "h3" as const, content: "Titel" };
		const inner: MailContainer = { ...emptyContainer("div", "Inner"), id: "inner", children: [heading] };
		return { ...emptyContainer("header", "Kop"), id: "kop", children: [{ ...text("Boven"), id: "t1" }, inner] };
	}

	function table(): Extract<MailNode, { kind: "columns" }> {
		return {
			id: "cols",
			kind: "columns",
			hidden: false,
			name: "Twee",
			alignSelf: "auto",
			grow: 0,
			gap: 16,
			box: emptyBox(),
			rows: [
				{
					id: "row1",
					cells: [
						{ id: "cell1", width: 50, verticalAlign: "top", box: emptyBox(), children: [{ ...text("Links"), id: "l1" }] },
						{ id: "cell2", width: 50, verticalAlign: "middle", box: emptyBox(), children: [{ ...text("Rechts"), id: "r1" }] },
					],
				},
			],
		};
	}

	it("turns a container and everything in it into one code block that looks the same", () => {
		const before = layoutWith([header()]);
		const after = convertNodeToCode(before, null, "kop", []);
		const converted = after.children[0] as MailBlock;
		expect(converted.kind).toBe("html");
		expect(converted.id).toBe("kop");
		expect(converted.grow).toBe(0);
		if (converted.kind !== "html") throw new Error("not code");
		expect(converted.html).toContain("<h3");
		expect(converted.html).toContain("Titel");
		expect(converted.html).toContain("<p");
		expect(converted.css).toContain("display:flex");
		expect(bare(compileLayout(after))).toBe(bare(compileLayout(before)));
		// It compiles as the header it was, not as a div around one.
		expect(compileLayout(after)).toContain('<header data-juno-block="html" data-juno-id="kop"');
	});

	it("turns a columns table into one code block, table, rows and cells kept", () => {
		const before: MailLayout = { ...emptyLayout(), children: [sectionWith([]), table()] };
		const after = convertNodeToCode(before, null, "cols", []);
		const converted = after.children[1] as MailBlock;
		if (converted.kind !== "html") throw new Error("not code");
		expect(converted.html).toContain("<table");
		expect(converted.html).toContain("<tr>");
		expect(converted.html).toContain('width="50%" valign="top"');
		expect(converted.html).toContain("Rechts");
		// The sanitiser writes a table's attributes in its own order, so the cells'
		// styles are what say it looks the same.
		const html = compileLayout(after);
		expect(html).toContain("width:50%;vertical-align:top;padding-right:8px");
		expect(html).toContain("width:50%;vertical-align:middle;padding-left:8px");
		expect(html).toContain('<p style="margin:0">Links</p>');
	});

	it("converts a node inside a container and a node inside a cell", () => {
		const nested: MailContainer = { ...emptyContainer("aside", "Kant"), id: "kant", children: [{ ...text("Zij"), id: "z1" }] };
		const inContainer = layoutWith([{ ...sectionWith([]), id: "outer", children: [nested] }]);
		const a = convertNodeToCode(inContainer, "outer", "kant", []);
		expect(((a.children[0] as MailContainer).children[0] as MailBlock).kind).toBe("html");

		const cols = table();
		cols.rows[0]!.cells[0]!.children = [nested];
		const b = convertNodeToCode({ ...emptyLayout(), children: [cols] }, "cell1", "kant", []);
		const converted = b.children[0];
		if (converted?.kind !== "columns") throw new Error("not columns");
		expect(converted.rows[0]?.cells[0]?.children[0]?.kind).toBe("html");
	});

	it("places a container in a cell by margins, since a cell is not a flex parent", () => {
		const centred: MailContainer = { ...emptyContainer("aside", "Kant"), id: "kant", alignSelf: "center", box: { ...emptyBox(), width: 200 } };
		const cols = table();
		cols.rows[0]!.cells[0]!.children = [centred];
		const html = compileLayout({ ...emptyLayout(), children: [cols] });
		expect(html).toContain("margin-left:auto;margin-right:auto");
		expect(html).not.toContain("align-self");
	});

	it("leaves out a hidden child, which is not in the message", () => {
		const container = header();
		container.children.push({ ...text("Weg"), id: "gone", hidden: true });
		const after = convertNodeToCode(layoutWith([container]), null, "kop", []);
		const converted = after.children[0] as MailBlock;
		expect(converted.kind === "html" ? converted.html : "").not.toContain("Weg");
	});

	it("drops what a breakpoint changed under the node and keeps whether it shows", () => {
		const layout: MailLayout = {
			...layoutWith([header()]),
			breakpoints: [
				{
					id: "b",
					name: "Phone",
					maxWidth: 480,
					sections: { kop: { hidden: true }, inner: { hidden: true } },
					blocks: { t1: { hidden: true }, h3: { text: { fontSize: 12 } } },
				},
			],
		};
		const after = convertNodeToCode(layout, null, "kop", []);
		const breakpoint = after.breakpoints[0];
		expect(breakpoint?.sections).toEqual({});
		expect(breakpoint?.blocks).toEqual({ kop: { hidden: true } });
		expect(breakpointCss(after)).toContain(".jb-kop{display:none !important}");
	});

	it("reads the converted code back from the code view, and writes it out again unchanged", () => {
		const after = convertNodeToCode(layoutWith([header()]), null, "kop", []);
		const html = compileLayout(after);
		const back = layoutFromHtml(html);
		expect(back.children[0]?.kind).toBe("html");
		expect(compileLayout(back)).toBe(html);
	});

	it("does nothing for an element that is not there, or is code already", () => {
		const before = layoutWith([header()]);
		expect(convertNodeToCode(before, null, "nope", [])).toBe(before);
		const once = convertNodeToCode(before, null, "kop", []);
		expect(convertNodeToCode(once, null, "kop", [])).toBe(once);
	});
});

describe("hidden at a breakpoint, for every kind of element", () => {
	it("hides a columns table and a block inside a cell, and styles the cell", () => {
		const cols: MailNode = {
			id: "cols",
			kind: "columns",
			hidden: false,
			name: "Twee",
			alignSelf: "auto",
			grow: 0,
			gap: 0,
			box: emptyBox(),
			rows: [{ id: "row1", cells: [{ id: "cell1", width: null, verticalAlign: "top", box: emptyBox(), children: [{ ...text("Cel"), id: "c1" }] }] }],
		};
		const layout: MailLayout = {
			...emptyLayout(),
			children: [cols],
			breakpoints: [
				{
					id: "b",
					name: "Phone",
					maxWidth: 480,
					sections: { cols: { hidden: true }, cell1: { box: { padding: { top: 8, right: 8, bottom: 8, left: 8 } } } },
					blocks: { c1: { hidden: true } },
				},
			],
		};
		const kept = normaliseLayout(JSON.parse(serialiseLayout(layout) ?? "null"));
		expect(kept?.breakpoints[0]?.sections.cols).toEqual({ hidden: true });
		const css = breakpointCss(layout);
		expect(css).toContain(".jb-cols{display:none !important}");
		expect(css).toContain(".jb-c1{display:none !important}");
		expect(css).toContain(".jb-cell1{padding:8px 8px 8px 8px !important}");
		const html = compileLayout(layout);
		expect(html).toContain('data-juno-id="cols" class="jb-cols"');
		expect(html).toContain('<td data-juno-id="cell1" valign="top" class="jb-cell1"');
	});

	it("shows a container that is hidden by default at a breakpoint that unhides it", () => {
		const layout: MailLayout = {
			...layoutWith([{ ...sectionWith([text("Mobiel")]), id: "s1", hidden: true }]),
			breakpoints: [{ id: "b", name: "Phone", maxWidth: 480, sections: { s1: { hidden: false } }, blocks: {} }],
		};
		const html = compileLayout(layout);
		expect(html).toContain("display:none;mso-hide:all");
		expect(breakpointCss(layout)).toContain(".jb-s1{display:flex !important}");
	});
});

describe("markup a converted container is made of", () => {
	it("keeps the section elements and the text elements a container and a text are written as", () => {
		const html =
			'<header><nav><a href="https://example.be">Menu</a></nav></header><main><article><aside>Kant</aside></article></main><section><pre>Een\nTwee</pre><address>Straat 1</address></section><footer>Voet</footer>';
		expect(sanitiseMarkup(html)).toBe(html);
	});
});
