import { describe, expect, it } from "vitest";
import { quoteForReply, quoteHtmlForReply, textToHtml } from "./mail-html";

describe("textToHtml quoting", () => {
	it("turns quoted lines into a blockquote even when they follow a plain line", () => {
		const html = textToHtml("Op 1 okt schreef Kris:\n> Top\n>\n> Ik heb het overgeschreven.");
		expect(html).toContain("<p ");
		expect(html).toContain("<blockquote");
		expect(html).not.toContain("&gt;");
		expect(html).toContain("Ik heb het overgeschreven.");
	});

	it("nests a quote inside a quote instead of leaving the second arrow in the text", () => {
		const html = textToHtml("> Antwoord\n> > Origineel");
		expect(html.match(/<blockquote/g)).toHaveLength(2);
		expect(html).not.toContain("&gt;");
	});

	it("keeps typed markup as text", () => {
		expect(textToHtml("> <b>hi</b>")).toContain("&lt;b&gt;hi&lt;/b&gt;");
	});
});

describe("quoteHtmlForReply", () => {
	const original = { fromLine: "Kris <kris@example.be>", sentAt: "1 okt 2026", text: "Top\n> eerder bericht" };

	it("shows the original in a blockquote with what it quoted nested inside", () => {
		const html = quoteHtmlForReply(original);
		expect(html).toContain("Op 1 okt 2026 schreef Kris &lt;kris@example.be&gt;:");
		expect(html.match(/<blockquote/g)).toHaveLength(2);
		expect(html).not.toContain("&gt; ");
	});

	it("leaves the text version with its arrows for clients that show text", () => {
		expect(quoteForReply(original)).toContain("> Top");
	});
});
