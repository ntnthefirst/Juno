import { describe, expect, it } from "vitest";
import { escapeHtml, placeholdersIn, render } from "./template-render";

const context = {
	client: {
		name: "obet",
		city: "Gent",
		vatNumber: "BE0123456789",
		notes: "",
	},
	owner: { businessName: "Digistra" },
	project: { name: "Website" },
};

describe("substitution", () => {
	it("fills a value", () => {
		expect(render("Tussen {{ owner.businessName }} en {{ client.name }}.", context).html).toBe(
			"Tussen Digistra en obet.",
		);
	});

	it("tolerates whitespace inside the braces", () => {
		expect(render("{{client.name}}|{{  client.name  }}", context).html).toBe("obet|obet");
	});

	it("reports which paths it used", () => {
		expect(render("{{ client.name }} {{ project.name }}", context).used).toEqual([
			"client.name",
			"project.name",
		]);
	});
});

describe("escaping", () => {
	it("escapes a value by default", () => {
		const hostile = { client: { name: '<script>alert("x")</script>' } };
		const { html } = render("{{ client.name }}", hostile);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("escapes every character that matters", () => {
		expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
	});

	it("leaves a value raw only when asked with &", () => {
		const ctx = { block: "<b>bold</b>" };
		expect(render("{{& block }}", ctx).html).toBe("<b>bold</b>");
		expect(render("{{ block }}", ctx).html).toBe("&lt;b&gt;bold&lt;/b&gt;");
	});

	it("escapes inside a conditional too", () => {
		const ctx = { client: { name: "<i>x</i>" } };
		const { html } = render("{{#if client.name}}{{ client.name }}{{/if}}", ctx);
		expect(html).toBe("&lt;i&gt;x&lt;/i&gt;");
	});
});

describe("missing values", () => {
	it("marks a missing value rather than leaving a blank", () => {
		const { html, missing } = render("BTW: {{ client.iban }}", context);
		expect(missing).toEqual(["client.iban"]);
		expect(html).toContain("ontbreekt: client.iban");
		expect(html).not.toBe("BTW: ");
	});

	it("treats an empty string as missing", () => {
		expect(render("{{ client.notes }}", context).missing).toEqual(["client.notes"]);
	});

	it("escapes the path in the marker, so a template cannot inject through it", () => {
		const { html } = render("{{ a.b }}", {});
		expect(html).toContain('data-field="a.b"');
	});

	it("does not report a filled value as missing", () => {
		expect(render("{{ client.vatNumber }}", context).missing).toEqual([]);
	});
});

describe("conditionals", () => {
	it("keeps an if block when the value is present", () => {
		expect(render("{{#if client.vatNumber}}BTW {{client.vatNumber}}{{/if}}", context).html).toBe(
			"BTW BE0123456789",
		);
	});

	it("drops an if block when the value is missing or empty", () => {
		expect(render("[{{#if client.iban}}IBAN{{/if}}]", context).html).toBe("[]");
		expect(render("[{{#if client.notes}}notes{{/if}}]", context).html).toBe("[]");
	});

	it("handles unless as the mirror of if", () => {
		expect(render("{{#unless client.iban}}geen IBAN{{/unless}}", context).html).toBe("geen IBAN");
		expect(render("{{#unless client.name}}geen naam{{/unless}}", context).html).toBe("");
	});

	it("resolves a nested conditional", () => {
		const html = render(
			"{{#if client.name}}A{{#if client.city}}B{{/if}}C{{/if}}",
			context,
		).html;
		expect(html).toBe("ABC");
	});

	it("does not spin on a malformed template", () => {
		const { html } = render("{{#if client.name}}unclosed", context);
		expect(html).toContain("unclosed");
	});
});

describe("placeholdersIn", () => {
	it("lists every path a template refers to", () => {
		expect(
			placeholdersIn("{{ client.name }} {{#if client.vatNumber}}{{ client.vatNumber }}{{/if}}"),
		).toEqual(["client.name", "client.vatNumber"]);
	});
});
