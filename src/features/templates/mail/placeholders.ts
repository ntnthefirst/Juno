import type { TemplateInput } from "@shared/types";

export type PlaceholderItem = {
	path: string;
	description: string;
};

export type PlaceholderGroup = {
	label: string;
	items: PlaceholderItem[];
};

/**
 * Every path a mail template can refer to, mirrored from the context
 * electron/main/services/document-context.ts builds (`buildContext`), so a
 * mail template and a document template reach for the same names. This file
 * cannot import that one (nothing under src/ reaches into electron/), so the
 * list is kept here by hand; a field added there has to be added here too.
 */
export function mailPlaceholderGroups(inputs: TemplateInput[]): PlaceholderGroup[] {
	return [
		{
			label: "Client",
			items: [
				{ path: "client.name", description: "Name" },
				{ path: "client.email", description: "Primary email" },
				{ path: "client.phone", description: "Primary phone" },
				{ path: "client.website", description: "Website" },
				{ path: "client.vatNumber", description: "VAT number" },
				{ path: "client.addressLine1", description: "Address line 1" },
				{ path: "client.addressLine2", description: "Address line 2" },
				{ path: "client.postalCode", description: "Postal code" },
				{ path: "client.city", description: "City" },
				{ path: "client.country", description: "Country" },
				{ path: "client.contactName", description: "Contact name" },
				{ path: "client.contactRole", description: "Contact role" },
				{ path: "client.contactEmail", description: "Contact email" },
			],
		},
		{
			label: "Project",
			items: [
				{ path: "project.name", description: "Name" },
				{ path: "project.description", description: "Description" },
				{ path: "project.startsOn", description: "Start date" },
				{ path: "project.dueOn", description: "Due date" },
				{ path: "project.agreedValue", description: "Agreed value" },
			],
		},
		{
			label: "Your business",
			items: [
				{ path: "owner.businessName", description: "Business name" },
				{ path: "owner.contactName", description: "Contact name" },
				{ path: "owner.email", description: "Email" },
				{ path: "owner.phone", description: "Phone" },
				{ path: "owner.vatNumber", description: "VAT number" },
			],
		},
		{
			label: "This template asks for",
			items: [
				{ path: "document.title", description: "Document title" },
				{ path: "document.issuedOn", description: "Issue date" },
				...inputs.map((input) => ({ path: `document.${input.key}`, description: input.label || input.key })),
			],
		},
	];
}
