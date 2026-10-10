import { describe, expect, it } from "vitest";
import type { TemplateInput } from "../../shared/types";
import { adoptRecordPlaceholders, foreignMailPlaceholders, keyForPath, mailContext } from "./mail-template-fields";

const naam: TemplateInput = { key: "naam", label: "Naam", kind: "text", required: true };

describe("foreignMailPlaceholders", () => {
	it("allows only the template's own inputs", () => {
		const text = "{{ document.naam }} {{ client.name }} {{#if owner.vatNumber}}x{{/if}} {{ document.title }}";
		expect(foreignMailPlaceholders(text, [naam])).toEqual(["client.name", "document.title", "owner.vatNumber"]);
	});
});

describe("keyForPath", () => {
	it("writes a key the input rules accept", () => {
		expect(keyForPath("client.contactName")).toBe("client_contact_name");
		expect(keyForPath("owner.businessName")).toBe("owner_business_name");
		expect(keyForPath("document.dueOn")).toBe("due_on");
		expect(keyForPath("project.agreedValue")).toBe("project_agreed_value");
	});
});

describe("mailContext", () => {
	it("reports a required input left blank, and not an optional one", () => {
		const optional: TemplateInput = { key: "btw", label: "Btw", kind: "text", required: false };
		expect(mailContext([naam, optional], { naam: "  " }).missing).toEqual(["document.naam"]);
	});

	it("takes a picture as bytes or an https address, and nothing else", () => {
		const foto: TemplateInput = { key: "foto", label: "Foto", kind: "image", required: true };
		const at = (value: string) => (mailContext([foto], { foto: value }).context.document as Record<string, string>).foto;
		expect(at("https://www.example.com/foto.jpg")).toBe("https://www.example.com/foto.jpg");
		expect(at("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
		expect(at("file:///C:/geheim.png")).toMatch(/^data:image\/svg\+xml/);
		expect(mailContext([foto], { foto: "javascript:alert(1)" }).missing).toEqual(["document.foto"]);
	});
});

describe("adoptRecordPlaceholders", () => {
	it("leaves a template that reads nothing alone", () => {
		expect(
			adoptRecordPlaceholders({ subject: "Hallo", bodyHtml: "<p>{{ document.naam }}</p>", layoutJson: null, inputs: [naam] }, {}),
		).toBeNull();
	});

	it("rewrites the canvas as well as the body, and keeps a key that is taken free", () => {
		const adopted = adoptRecordPlaceholders(
			{
				subject: "Voor {{client.name}}",
				bodyHtml: "<p>{{& client.name }}</p>",
				layoutJson: '{"html":"Beste {{ client.name }}"}',
				inputs: [{ key: "client_name", label: "Al bezet", kind: "text", required: false }],
			},
			{},
		)!;
		expect(adopted.subject).toBe("Voor {{document.client_name_2}}");
		expect(adopted.bodyHtml).toBe("<p>{{& document.client_name_2 }}</p>");
		expect(adopted.layoutJson).toBe('{"html":"Beste {{ document.client_name_2 }}"}');
		expect(adopted.inputs.map((input) => input.key)).toEqual(["client_name", "client_name_2"]);
	});
});
