import { describe, expect, it } from "vitest";
import { resolveInputSources, type SourceRecords } from "./input-sources";
import type { Client, Contact, TemplateInput } from "./types";

const records: SourceRecords = {
	client: { name: "Obet", vatNumber: "BE0123456789", website: null } as Client,
	contact: { name: "Laura Peeters", email: "laura@obet.be", phone: null } as Contact,
	email: "info@obet.be",
	project: null,
};

const input = (key: string, source: TemplateInput["source"]): TemplateInput => ({ key, label: key, kind: "text", required: false, source });

describe("resolveInputSources", () => {
	it("fills each input from the record it names", () => {
		const out = resolveInputSources(
			[input("voornaam", "contact_first_name"), input("klant", "client_name"), input("btw", "client_vat"), input("mail", "client_email")],
			records,
		);
		expect(out).toEqual({ voornaam: "Laura", klant: "Obet", btw: "BE0123456789", mail: "info@obet.be" });
	});

	it("leaves out inputs with no source and sources with no answer", () => {
		const out = resolveInputSources([input("plain", null), input("site", "client_website"), input("project", "project_name")], records);
		expect(out).toEqual({});
	});
});
