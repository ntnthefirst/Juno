import type { ListClientsQuery } from "../../shared/api";
import { CLIENT_LINK_KINDS } from "../../shared/client-links";
import type { ClientIntakeInput, ClientPatch } from "../../shared/types";
import { CLIENT_LANGUAGES } from "../../shared/client-language";
import * as intake from "../services/client-intake";
import * as clients from "../services/clients";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	name: "name",
	status_id: "statusId",
	website: "website",
	vat_number: "vatNumber",
	notes: "notes",
	language: "language",
} as const;

function fields(args: Record<string, unknown>): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [argument, column] of Object.entries(FIELDS)) {
		if (argument in args) mapped[column] = args[argument];
	}
	return mapped;
}

const manyIds: Record<string, unknown> = {
	type: "object",
	properties: {
		client_ids: {
			type: "array",
			items: { type: "string" },
			minItems: 1,
			maxItems: 500,
			description: "The clients' ids, from clients.list. At most 500.",
		},
	},
	required: ["client_ids"],
	additionalProperties: false,
};

const writableProperties: Record<string, unknown> = {
	status_id: {
		type: ["string", "null"],
		description:
			"Id of an item in the client_status reference set, or null for no status. A change is recorded on the client's timeline.",
	},
	website: { type: ["string", "null"], description: "Full URL including the scheme." },
	vat_number: { type: ["string", "null"], description: "VAT number in BE0123456789 format." },
	notes: {
		type: ["string", "null"],
		description: "Free text notes about the client, rendered as Markdown.",
	},
	language: {
		type: "string",
		enum: CLIENT_LANGUAGES.map((language) => language.value),
		description:
			"What the client is written to in: nl is Dutch with u, nl-je is Dutch with je, fr or en. Defaults to nl.",
	},
};

/** Maps the snake_case keys of each entry in a list to the service's names. */
function entries(list: unknown, keys: Record<string, string>): Record<string, unknown>[] | undefined {
	if (!Array.isArray(list)) return undefined;
	return list.map((item) => {
		const source = (item ?? {}) as Record<string, unknown>;
		const mapped: Record<string, unknown> = {};
		for (const [argument, column] of Object.entries(keys)) {
			if (argument in source) mapped[column] = source[argument];
		}
		return mapped;
	});
}

const flag = (what: string): Record<string, unknown> => ({
	type: "boolean",
	description: `Make this the client's primary ${what}. Only one entry in the list can be primary. If none is marked, the first one is.`,
});

const label = (example: string): Record<string, unknown> => ({
	type: ["string", "null"],
	description: `Free text naming this entry, for example "${example}".`,
});

const childLists: Record<string, unknown> = {
	emails: {
		type: "array",
		description: "Email addresses. Use this instead of email when there are several.",
		items: {
			type: "object",
			properties: {
				email: { type: "string", description: "Email address, for example info@hyge.be." },
				label: label("Facturatie"),
				is_primary: flag("email address"),
			},
			required: ["email"],
			additionalProperties: false,
		},
	},
	phones: {
		type: "array",
		description: "Phone numbers. Use this instead of phone when there are several.",
		items: {
			type: "object",
			properties: {
				phone: { type: "string", description: "Phone number as typed, for example +32 470 12 34 56." },
				label: label("Gsm"),
				is_primary: flag("phone number"),
			},
			required: ["phone"],
			additionalProperties: false,
		},
	},
	addresses: {
		type: "array",
		description: "Postal addresses. Use this instead of address when there are several or when the parts are known.",
		items: {
			type: "object",
			properties: {
				address_line1: { type: "string", description: "Street and number, for example Kerkstraat 1." },
				address_line2: { type: ["string", "null"], description: "Extra address line, if any." },
				postal_code: { type: ["string", "null"], description: "Postal code, for example 9000." },
				city: { type: ["string", "null"], description: "City, for example Gent." },
				country: { type: ["string", "null"], description: "Country name or ISO code, for example BE." },
				label: label("Kantoor Leuven"),
				is_primary: flag("address"),
			},
			required: ["address_line1"],
			additionalProperties: false,
		},
	},
	links: {
		type: "array",
		description: "Web addresses: website and social profiles.",
		items: {
			type: "object",
			properties: {
				url: { type: "string", description: "The address, such as https://www.linkedin.com/company/hyge. A missing https:// is added." },
				kind: {
					type: "string",
					enum: [...CLIENT_LINK_KINDS],
					description: "What the link is. Left out, it is guessed from the address.",
				},
				label: label("Company page"),
			},
			required: ["url"],
			additionalProperties: false,
		},
	},
	contacts: {
		type: "array",
		description: "People at the client. Unlike the lists above, the first contact is only primary when is_primary is set.",
		items: {
			type: "object",
			properties: {
				name: { type: "string", description: "The person's name." },
				role: { type: ["string", "null"], description: "Job title or role at the client." },
				email: { type: ["string", "null"], description: "Email address for this person." },
				phone: { type: ["string", "null"], description: "Telephone number for this person." },
				notes: { type: ["string", "null"], description: "Free text notes about this person." },
				is_primary: flag("contact"),
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
};

export const clientTools: ToolDescriptor[] = [
	{
		name: "clients.list",
		title: "List clients",
		description:
			"List clients with their status and project counts. Use the search argument to find a client by name, email, city or VAT number before calling a tool that needs a client id.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				search: {
					type: "string",
					description: "Match against name, email, city and VAT number. Case-insensitive.",
				},
				status_id: {
					type: ["string", "null"],
					description: "Only clients with this status. Null means clients with no status.",
				},
				include_deleted: {
					type: "boolean",
					description: "Include soft-deleted clients. Defaults to false.",
				},
				limit: { type: "integer", description: "Rows to return. Defaults to 200, maximum 1000." },
				offset: { type: "integer", description: "Rows to skip, for paging." },
			},
			additionalProperties: false,
		},
		handler: (args) =>
			clients.list({
				search: args.search as string | undefined,
				statusId: args.status_id as string | null | undefined,
				includeDeleted: args.include_deleted as boolean | undefined,
				limit: args.limit as number | undefined,
				offset: args.offset as number | undefined,
			} satisfies ListClientsQuery),
	},
	{
		name: "clients.get",
		title: "Get a client",
		description: "Read one client by id. Returns null when the client does not exist or was deleted.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clients.get(args.client_id as string),
	},
	{
		name: "clients.create",
		title: "Create a client",
		description:
			"Create a client. Only the name is required; everything else can be filled in later. Everything is created in one step: either all of it is saved or none of it. Give several email addresses, phone numbers, addresses, links and contact persons with the emails, phones, addresses, links and contacts lists. The first email, phone and address become primary unless one is marked is_primary. email, phone and address are shortcuts for a single primary entry; do not combine a shortcut with its list.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "The client's name as it should be displayed." },
				...writableProperties,
				email: { type: ["string", "null"], description: "Primary email address." },
				phone: { type: ["string", "null"], description: "Primary phone number." },
				address: { type: ["string", "null"], description: "Primary address on one line, for example 'Kerkstraat 1, 9000 Gent'." },
				...childLists,
			},
			required: ["name"],
			additionalProperties: false,
		},
		handler: (args) =>
			intake.createWithContact({
				...fields(args),
				email: args.email,
				phone: args.phone,
				address: args.address,
				emails: entries(args.emails, { email: "email", label: "label", is_primary: "isPrimary" }),
				phones: entries(args.phones, { phone: "phone", label: "label", is_primary: "isPrimary" }),
				addresses: entries(args.addresses, {
					address_line1: "addressLine1",
					address_line2: "addressLine2",
					postal_code: "postalCode",
					city: "city",
					country: "country",
					label: "label",
					is_primary: "isPrimary",
				}),
				links: entries(args.links, { url: "url", kind: "kind", label: "label" }),
				contacts: entries(args.contacts, {
					name: "name",
					role: "role",
					email: "email",
					phone: "phone",
					notes: "notes",
					is_primary: "isPrimary",
				}),
			} as ClientIntakeInput),
	},
	{
		name: "clients.update",
		title: "Update a client",
		description:
			"Change one or more fields on a client. Fields left out are untouched; pass null to clear one.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "The client's id." },
				name: { type: "string", description: "The client's name as it should be displayed." },
				...writableProperties,
			},
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clients.update(args.client_id as string, fields(args) as ClientPatch),
	},
	{
		name: "clients.delete",
		title: "Delete a client",
		description:
			"Soft delete a client. The row stays in the database and can be restored with clients.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clients.remove(args.client_id as string),
	},
	{
		name: "clients.restore",
		title: "Restore a client",
		description: "Bring a soft-deleted client back. Fails if the client was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clients.restore(args.client_id as string),
	},
	{
		name: "clients.archive_many",
		title: "Archive several clients",
		description:
			"Give each client the Archived status, in one go. A client that is deleted is left alone. Every id must be a client's, or nothing changes. Returns the clients it archived.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: manyIds,
		prepare: async (args) => clients.reviewMany("archive", args.client_ids as string[]),
		handler: (args) => clients.archiveMany(args.client_ids as string[]),
	},
	{
		name: "clients.delete_many",
		title: "Delete several clients",
		description:
			"Soft delete each client, in one go, as one request listing every client. A client already deleted is left alone. Every id must be a client's, or nothing changes. Undo with clients.restore_many.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: manyIds,
		prepare: async (args) => clients.reviewMany("delete", args.client_ids as string[]),
		handler: (args) => clients.removeMany(args.client_ids as string[]),
	},
	{
		name: "clients.restore_many",
		title: "Restore several clients",
		description:
			"Bring each soft-deleted client back, in one go. A client that is not deleted is left alone. Every id must be a client's, or nothing changes.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: manyIds,
		prepare: async (args) => clients.reviewMany("restore", args.client_ids as string[]),
		handler: (args) => clients.restoreMany(args.client_ids as string[]),
	},
];
