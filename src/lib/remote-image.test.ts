import { describe, expect, it } from "vitest";
import { framed } from "./framed-preview";
import { isDrawable, REMOTE_IMAGE_NOTE, withoutRemoteImages } from "./remote-image";

describe("isDrawable", () => {
	it("draws only what Juno already holds", () => {
		expect(isDrawable("data:image/png;base64,AAAA")).toBe(true);
		expect(isDrawable("blob:app://juno/1")).toBe(true);
		expect(isDrawable("app://juno/logo.png")).toBe(true);
		expect(isDrawable("https://www.example.com/logo.png")).toBe(false);
		expect(isDrawable("http://www.example.com/logo.png")).toBe(false);
		expect(isDrawable("{{ document.foto }}")).toBe(false);
	});
});

describe("withoutRemoteImages", () => {
	it("swaps a picture at a web address for a box that keeps its width and says who loads it", () => {
		const html = '<p>Dag</p><img data-juno-block="image" src="https://www.example.com/logo.png" alt="Logo van uw bedrijf" style="display:block;max-width:100%;width:96px;height:auto"><p>Tot ziens</p>';
		const out = withoutRemoteImages(html);
		expect(out).not.toContain("<img");
		expect(out).not.toContain("https://www.example.com");
		expect(out).toContain("width:96px");
		expect(out).toContain("Logo van uw bedrijf");
		expect(out).toContain(REMOTE_IMAGE_NOTE.replace(/&/g, "&amp;"));
		expect(out.startsWith("<p>Dag</p><span")).toBe(true);
		expect(out.endsWith("<p>Tot ziens</p>")).toBe(true);
	});

	it("escapes the alt text it prints", () => {
		const out = withoutRemoteImages('<img src="https://x.test/a.png" alt="&lt;script&gt;alert(1)&lt;/script&gt;">');
		expect(out).not.toContain("<script>");
		expect(out).toContain("&lt;script&gt;");
	});

	it("finds a tag whose attribute holds a greater-than sign", () => {
		const out = withoutRemoteImages('<img alt="a > b" src="https://x.test/a.png" style="width:10px">');
		expect(out).not.toContain("<img");
		expect(out).toContain("a &gt; b");
	});

	it("leaves a picture Juno can draw alone", () => {
		const html = '<img src="data:image/png;base64,AAAA" alt="x">';
		expect(withoutRemoteImages(html)).toBe(html);
	});

	it("takes every picture in a message, and nothing else", () => {
		const html = '<img src="https://a.test/1.png"><a href="https://a.test/x">x</a><img src="https://a.test/2.png" alt="Twee">';
		const out = withoutRemoteImages(html);
		expect(out.match(/data-juno-remote-image/g)).toHaveLength(2);
		expect(out).toContain('<a href="https://a.test/x">x</a>');
	});
});

describe("framed", () => {
	it("removes the picture and the font link from the message it frames", () => {
		const html =
			'<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins"></head><body><img src="https://www.example.com/logo.png" alt="Logo"></body></html>';
		const out = framed(html, "@font-face{}");
		expect(out).not.toContain("<img");
		expect(out).not.toContain("<link");
		expect(out).toContain("<style>@font-face{}</style>");
	});
});
