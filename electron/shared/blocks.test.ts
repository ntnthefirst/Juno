import { describe, expect, it } from "vitest";
import { blocksText, blocksToHtml, cleanBlocks, parseMarkdown, sanitiseInline, toMarkdown } from "./blocks";

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
