import { describe, expect, it } from "vitest";
import { canvasShell, mailShell } from "./mail-html";

describe("canvasShell", () => {
	it("sends a canvas with nothing around it: no card, no accent line, no footer", () => {
		const html = canvasShell('<div data-juno-canvas="1">Dag</div>');
		expect(html).toContain('<div data-juno-canvas="1">Dag</div>');
		expect(html).not.toContain("<table");
		expect(html).not.toContain("border-top:3px");
		expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
	});

	it("puts the fonts and the breakpoints in the head", () => {
		const html = canvasShell("Dag", {
			fontLinks: ["https://fonts.googleapis.com/css2?family=Inter"],
			css: "@media only screen and (max-width:480px){.jb-t1{font-size:14px !important}}",
		});
		const head = html.slice(0, html.indexOf("</head>"));
		expect(head).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">');
		expect(head).toContain("<style>@media only screen and (max-width:480px)");
	});

	it("cannot be made to close its own style element", () => {
		const html = canvasShell("Dag", { css: ".a{color:red}</style><script>alert(1)</script>" });
		expect(html).not.toContain("<script>");
		expect(html.match(/<\/style>/g)).toHaveLength(1);
	});

	it("leaves the house shell to a hand-written template, footer and all", () => {
		const html = mailShell("<p>Dag</p>", { footerLines: ["Studio Noord"] });
		expect(html).toContain("Studio Noord");
		expect(html).toContain("<table");
	});
});
