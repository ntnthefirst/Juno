import type { ListClientsQuery } from "../../shared/api";
import type { ClientInput, ClientPatch } from "../../shared/types";
import * as clients from "../services/clients";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	name: "name",
	status_id: "statusId",
	email: "email",
	phone: "phone",
	website: "website",
	vat_number: "vatNumber",
	address_line1: "addressLine1",
	address_line2: "addressLine2",
	postal_code: "postalCode",
	city: "city",
	country: "country",
	notes: "notes",
} as const;

function fields(args: Record<string, unknown>): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [argument, column] of Object.entries(FIELDS)) {
		if (argument in args) mapped[column] = args[argument];
	}
	return mapped;
}

const writableProperties: Record<string, unknown> = {
	status_id: {
		type: ["string", "null"],
		description: "Id of an item in the client_status reference set.",
	},
	email: { type: ["string", "null"], description: "General email address for the client." },
	phone: { type: ["string", "null"], description: "Telephone number, as the client writes it." },
	website: { type: ["string", "null"], description: "Full URL including the scheme." },
	vat_number: { type: ["string", "null"], description: "VAT number in BE0123456789 format." },
	address_line1: { type: ["string", "null"], description: "Street and number." },
	address_line2: { type: ["string", "null"], description: "Extra address line, if any." },
	postal_code: { type: ["string", "null"], description: "Postal code." },
	city: { type: ["string", "null"], description: "City." },
	country: { type: ["string", "null"], description: "Country name or ISO code." },
	notes: { type: ["string", "null"], description: "Free text notes about the client." },
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
		description: "Create a client. Only the name is required; everything else can be filled in later.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "The client's name as it should be displayed." },
				...writableProperties,
			},
			required: ["name"],
			additionalProperties: false,
		},
		handler: (args) => clients.create(fields(args) as ClientInput),
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
];
