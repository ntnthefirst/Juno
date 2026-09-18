/**
 * The sanitiser is the line between a message and the machine. Each case here
 * is one thing an email can carry that must not survive the trip.
 */
import { describe, expect, it } from "vitest";
import { normaliseSubject, safeFilename, snippetOf } from "./mail-parse";
import { extractStyles, sanitiseHtml, textDocument } from "./mail-sanitise";

describe("sanitiseHtml", () => {
	it("drops scripts, frames, forms and event handlers", () => {
		const { document } = sanitiseHtml(
			'<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://x"></iframe>' +
				'<form action="https://x"><input name="a"></form><object data="x"></object>',
		);
		expect(document).toContain("<p>Hi</p>");
		expect(document).not.toContain("<script");
		expect(document).not.toContain("<iframe");
		expect(document).not.toContain("<form");
		expect(document).not.toContain("<object");
		expect(document).not.toContain("onclick");
	});

	it("blocks remote images by default, counts them, and keeps them on request", () => {
		const html = '<img src="https://t.example/pixel.gif" width="1"><img src="data:image/png;base64,AAAA">';
		const blocked = sanitiseHtml(html);
		expect(blocked.remoteImages).toBe(1);
		expect(blocked.document).not.toContain("t.example");
		expect(blocked.document).toContain("data:image/png;base64,AAAA");
		expect(blocked.document).toContain("img-src data:;");

		const allowed = sanitiseHtml(html, { allowRemoteImages: true });
		expect(allowed.remoteImages).toBe(0);
		expect(allowed.document).toContain("https://t.example/pixel.gif");
		expect(allowed.document).toContain("img-src data: https:");
	});

	it("moves link targets out of href so a click goes nowhere, and lists them", () => {
		const { document, links } = sanitiseHtml(
			'<a href="https://obet.be/x">Bekijk</a> <a href="javascript:alert(1)">bad</a> <a href="mailto:a@b.be">mail</a>',
		);
		expect(document).not.toMatch(/\shref="/);
		expect(document).toContain('data-href="https://obet.be/x"');
		expect(document).not.toContain("javascript:");
		expect(links).toEqual([
			{ href: "https://obet.be/x", text: "Bekijk" },
			{ href: "mailto:a@b.be", text: "mail" },
		]);
	});

	it("keeps layout styles and cuts the ones that fetch or run", () => {
		const { document } = sanitiseHtml(
			'<td style="color: red; background: url(https://x/a.png); width: 10px">x</td>' +
				"<style>.a { color: blue; background-image: url(https://x/b.png) } @import url(https://x/c.css);</style>",
		);
		expect(document).toContain("color: red; width: 10px");
		expect(document).not.toContain("a.png");
		expect(document).toContain(".a { color: blue; background-image: none }");
		expect(document).not.toContain("@import");
	});

	it("inlines a cid image from the attachment map and drops one it cannot find", () => {
		const { document } = sanitiseHtml('<img src="cid:logo@x"><img src="cid:missing@x">', {
			inlineImages: new Map([["logo@x", "data:image/png;base64,QUJD"]]),
		});
		expect(document).toContain("data:image/png;base64,QUJD");
		expect(document).not.toContain("cid:");
		expect((document.match(/<img/g) ?? []).length).toBe(1);
	});

	it("produces a document with its own policy", () => {
		const { document } = sanitiseHtml("<p>x</p>");
		expect(document.startsWith("<!doctype html>")).toBe(true);
		expect(document).toContain('http-equiv="Content-Security-Policy"');
		expect(document).toContain("default-src 'none'");
	});
});

describe("extractStyles", () => {
	it("pulls every style block out of the body", () => {
		const { css, html } = extractStyles("<style>p{}</style><p>a</p><STYLE type='text/css'>b{}</STYLE>");
		expect(html).toBe("<p>a</p>");
		expect(css).toContain("p{}");
		expect(css).toContain("b{}");
	});
});

describe("textDocument", () => {
	it("escapes markup and marks quoted lines", () => {
		const document = textDocument("Hallo <b>\n> vorige");
		expect(document).toContain("Hallo &lt;b&gt;");
		expect(document).toContain('<span class="q">&gt; vorige</span>');
	});
});

describe("parse helpers", () => {
	it("normalises subjects across the prefixes a Belgian mailbox sees", () => {
		expect(normaliseSubject("Re: Fwd: AW: Offerte")).toBe("offerte");
		expect(normaliseSubject("RE[2]: Offerte")).toBe("offerte");
		expect(normaliseSubject("[bureau-dev] Antw: Offerte")).toBe("offerte");
		expect(normaliseSubject("  Offerte  hosting ")).toBe("offerte hosting");
	});

	it("takes a snippet from above the signature and outside the quote", () => {
		expect(snippetOf("Dag Laura,\n\nHierbij.\n> oud\n-- \nNathan")).toBe("Dag Laura, Hierbij.");
		expect(snippetOf("a".repeat(400))).toHaveLength(160);
		expect(snippetOf(null)).toBe("");
	});

	it("makes a filename safe", () => {
		expect(safeFilename("../../etc/passwd")).toBe("passwd");
		expect(safeFilename("..\\..\\x.pdf")).toBe("x.pdf");
		expect(safeFilename("con.txt")).toBe("_con.txt");
		expect(safeFilename("a:b*c?.pdf")).toBe("a_b_c_.pdf");
		expect(safeFilename("")).toBe("attachment");
		expect(safeFilename("..")).toBe("attachment");
		expect(safeFilename(`${"x".repeat(200)}.pdf`)).toHaveLength(120);
	});
});
