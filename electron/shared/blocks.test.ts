import { describe, expect, it } from "vitest";
import { blocksText, blocksToHtml, cleanBlocks, parseMarkdown, safeLinkHref, sanitiseInline, toMarkdown, type ImageBlock } from "./blocks";

describe("blocks", () => {
	it("reads a checklist, a bullet, a heading and text from Markdown, and writes them back", () => {
		const markdown = "# Title\n- [x] Sharpen the chisels\n- [ ] Order screws\n- plain bullet\nRemember the oak.";
		const blocks = parseMarkdown(markdown);
		expect(blocks.map((block) => block.type)).toEqual(["heading", "check", "check", "bullet", "text"]);
		expect(blocks[1]).toMatchObject({ done: true, text: "Sharpen the chisels" });
		expect(toMarkdown(blocks)).toBe(markdown);
	});

	it("escapes what a note types, so a bracket is not a tag", () => {
		const [block] = parseMarkdown("a <script>x</script> & b");
		expect(block).toMatchObject({ text: "a &lt;script&gt;x&lt;/script&gt; &amp; b" });
		expect(toMarkdown([block!])).toBe("a <script>x</script> & b");
	});

	it("keeps bold, italic and underline and drops every other tag", () => {
		expect(sanitiseInline('<b>a</b> <strong>b</strong> <a href="x" onclick="y">c</a><img src=x>')).toBe(
			"<b>a</b> <b>b</b> c",
		);
		expect(sanitiseInline("<u>open")).toBe("<u>open</u>");
	});

	it("rebuilds only well-formed blocks", () => {
		const blocks = cleanBlocks([
			{ id: "a", type: "heading", text: "<i>x</i><script>1</script>" },
			{ id: "a", type: "check", text: "y", done: true },
			{ type: "nonsense" },
			{ type: "table", header: ["Item", 3], rows: [["a", "b"]] },
		]);
		expect(blocks).toHaveLength(3);
		expect(blocks[0]).toMatchObject({ id: "a", text: "<i>x</i>1" });
		expect(blocks[1]!.id).not.toBe("a");
		expect(blocks[2]).toMatchObject({ header: ["Item", ""] });
		expect(() => cleanBlocks("no")).toThrow();
	});

	it("compiles a body and a searchable text", () => {
		const blocks = cleanBlocks([
			{ type: "heading", text: "The job" },
			{ type: "check", text: "Tick", done: true },
			{ type: "table", header: ["Item"], rows: [["Oak"]] },
		]);
		const html = blocksToHtml(blocks);
		expect(html).toContain("<h2>The job</h2>");
		expect(html).toContain("&#9745; Tick");
		expect(html).toContain("<td>Oak</td>");
		expect(blocksText(blocks)).toBe("The job Tick Item Oak");
	});
});

describe("links in a line", () => {
	it("keeps an https link and a mail link, and nothing else with an address", () => {
		expect(sanitiseInline('see <a href="https://juno.test/a?b=1&amp;c=2">this</a>')).toBe(
			'see <a href="https://juno.test/a?b=1&amp;c=2">this</a>',
		);
		expect(sanitiseInline('<a href="mailto:hallo@juno.test">mail</a>')).toBe('<a href="mailto:hallo@juno.test">mail</a>');
		expect(sanitiseInline('<a href="javascript:alert(1)">x</a>')).toBe("x");
		expect(sanitiseInline('<a href="data:text/html,hi">x</a>')).toBe("x");
		expect(sanitiseInline('<a href="file:///c:/secret" onclick="x()">x</a>')).toBe("x");
		expect(sanitiseInline('<a href="http://plain.test">x</a>')).toBe("x");
	});

	it("closes a link that was left open and drops a stray close", () => {
		expect(sanitiseInline('<a href="https://juno.test">open')).toBe('<a href="https://juno.test/">open</a>');
		expect(sanitiseInline("none</a>")).toBe("none");
	});

	it("gives a bare domain https and refuses a word", () => {
		expect(safeLinkHref("juno.test/path")).toBe("https://juno.test/path");
		expect(safeLinkHref("nothing")).toBeNull();
		expect(safeLinkHref("https://")).toBeNull();
		expect(safeLinkHref("ftp://juno.test")).toBeNull();
	});
});

describe("pictures in a page", () => {
	const good = { id: "i1", type: "image", path: "pages/0190a000-0000-7000-8000-000000000000/0190a000-0000-7000-8000-000000000001.png", alt: "Table" };

	it("keeps a picture whose path is the one the service makes", () => {
		expect(cleanBlocks([good])).toEqual([good]);
	});

	it("drops a path that is absolute, climbs out, or is not a picture type", () => {
		const bad = ["C:/secret.png", "../x.png", "pages/../../x.png", "pages/a/b.svg", "pages/a/b/c.png", "/pages/a/b.png"];
		for (const path of bad) expect(cleanBlocks([{ ...good, path }])).toEqual([]);
	});

	it("reads as its caption in search and has no markdown", () => {
		expect(blocksText([good as ImageBlock])).toBe("Table");
		expect(toMarkdown([good as ImageBlock])).toBe("Table");
	});
});
