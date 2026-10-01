import { describe, expect, it } from "vitest";
import { sanitiseHtml, textDocumentBody } from "./mail-sanitise";

describe("quoted history in the reader", () => {
	it("shows a plain-text quote at any depth as nested blockquotes, not as arrows", () => {
		const { document } = textDocumentBody("Hoi\nOp 1 okt schreef Kris:\n> Top\n> > diep\n>> ook diep\nEinde");
		expect(document.match(/<blockquote>/g)).toHaveLength(2);
		expect(document).not.toContain("&gt;");
	});

	it("gives every client's quote one look, whatever style it came with", () => {
		const { document } = sanitiseHtml('<blockquote style="border-left:1px #ccc solid">Oud</blockquote>');
		expect(document).toContain("border-left: 2px solid #d9d6cf !important");
	});

	it("carries the script that straightens quotes other clients wrote as arrows or headers", () => {
		const { document, scriptNonce } = sanitiseHtml("<div>&gt; oud</div>");
		expect(document).toContain(`<script nonce="${scriptNonce}">`);
		expect(document).toContain("divRplyFwdMsg");
	});
});
