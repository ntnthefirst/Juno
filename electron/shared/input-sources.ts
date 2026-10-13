import type { Client, Contact, InputSource, Project, TemplateInput } from "./types";

/** What an input can be filled from, in the order the editor offers them. */
export const INPUT_SOURCES: { value: InputSource; label: string }[] = [
	{ value: "client_name", label: "Client name" },
	{ value: "contact_first_name", label: "Contact first name" },
	{ value: "contact_name", label: "Contact full name" },
	{ value: "contact_email", label: "Contact email" },
	{ value: "contact_phone", label: "Contact phone" },
	{ value: "client_email", label: "Client email" },
	{ value: "client_vat", label: "Client VAT number" },
	{ value: "client_website", label: "Client website" },
	{ value: "project_name", label: "Project name" },
];

/** The records a template is used against. Any of them may be absent. */
export type SourceRecords = {
	client: Client | null;
	/** The client's primary contact, or the only one. */
	contact: Contact | null;
	/** The client's primary email address. */
	email: string | null;
	project: Project | null;
};

function valueOf(source: InputSource, records: SourceRecords): string {
	switch (source) {
		case "client_name":
			return records.client?.name ?? "";
		case "contact_first_name":
			return records.contact?.name.trim().split(/\s+/)[0] ?? "";
		case "contact_name":
			return records.contact?.name ?? "";
		case "contact_email":
			return records.contact?.email ?? "";
		case "contact_phone":
			return records.contact?.phone ?? "";
		case "client_email":
			return records.email ?? "";
		case "client_vat":
			return records.client?.vatNumber ?? "";
		case "client_website":
			return records.client?.website ?? "";
		case "project_name":
			return records.project?.name ?? "";
	}
}

/**
 * The starting value for every input that is filled from a record, keyed by
 * input key. An input whose record has no answer is left out, so a value the
 * person already typed is not wiped by a client that lacks the field.
 */
export function resolveInputSources(inputs: TemplateInput[], records: SourceRecords): Record<string, string> {
	const out: Record<string, string> = {};
	for (const input of inputs) {
		if (!input.source) continue;
		const value = valueOf(input.source, records).trim();
		if (value) out[input.key] = value;
	}
	return out;
}
