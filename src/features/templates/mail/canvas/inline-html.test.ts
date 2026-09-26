import { describe, expect, it } from "vitest";
import { normaliseEditedHtml } from "./inline-html";

describe("normaliseEditedHtml", () => {
	it("turns the divs a new line makes into breaks", () => {
		expect(normaliseEditedHtml("Beste Jan,<div>Tot morgen.</div>")).toBe("Beste Jan,<br>Tot morgen.");
		expect(normaliseEditedHtml("<div>Een</div><div><br></div><div>Twee</div>")).toBe("Een<br><br>Twee");
	});

	it("writes a strikethrough the way a text block keeps it", () => {
		expect(normaliseEditedHtml("<strike>oud</strike> nieuw")).toBe("<s>oud</s> nieuw");
	});

	it("keeps bold, italic, underline and links as they are", () => {
		const html = '<b>vet</b> <i>schuin</i> <u>onder</u> <a href="https://example.be">link</a>';
		expect(normaliseEditedHtml(html)).toBe(html);
	});

	it("drops a pasted font tag and keeps its words", () => {
		expect(normaliseEditedHtml('<font face="Arial">Dag</font>')).toBe("Dag");
	});
});
