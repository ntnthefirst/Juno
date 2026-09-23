import type { ClientAddressInput, ClientAddressPatch } from "../../shared/types";
import * as clientAddresses from "../services/client-addresses";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	label: "label",
	address_line1: "addressLine1",
	address_line2: "addressLine2",
	postal_code: "postalCode",
	city: "city",
	country: "country",
	is_primary: "isPrimary",
} as const;

function fields(args: Record<string, unknown>): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [argument, column] of Object.entries(FIELDS)) {
		if (argument in args) mapped[column] = args[argument];
	}
	return mapped;
}

const writableProperties: Record<string, unknown> = {
	label: {
		type: ["string", "null"],
		description: "Free text naming this address, such as \"Kantoor Leuven\" or \"Magazijn\".",
	},
	address_line2: { type: ["string", "null"], description: "Extra address line, if any." },
	postal_code: { type: ["string", "null"], description: "Postal code." },
	city: { type: ["string", "null"], description: "City." },
	country: { type: ["string", "null"], description: "Country name or ISO code." },
	is_primary: {
		type: "boolean",
		description: "Make this the client's primary address. Clears the flag on the others.",
	},
};

export const clientAddressTools: ToolDescriptor[] = [
	{
		name: "clients.addresses.list_for_client",
		title: "List a client's addresses",
		description: "List the addresses on file for one client, primary first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clientAddresses.listForClient(args.client_id as string),
	},
	{
		name: "clients.addresses.create",
		title: "Add an address",
		description:
			"Add an address to a client. The first one added becomes primary on its own; a later one only if is_primary is set.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "The client's id." },
				address_line1: { type: "string", description: "Street and number." },
				...writableProperties,
			},
			required: ["client_id", "address_line1"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientAddresses.create({
				...fields(args),
				clientId: args.client_id as string,
			} as ClientAddressInput),
	},
	{
		name: "clients.addresses.update",
		title: "Update an address",
		description: "Change one or more fields on a client's address. Fields left out are untouched.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				address_id: { type: "string", description: "The address row's id." },
				address_line1: { type: "string", description: "Street and number." },
				...writableProperties,
			},
			required: ["address_id"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientAddresses.update(args.address_id as string, fields(args) as ClientAddressPatch),
	},
	{
		name: "clients.addresses.delete",
		title: "Remove an address",
		description:
			"Soft delete a client's address. The row stays in the database and can be restored with clients.addresses.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { address_id: { type: "string", description: "The address row's id." } },
			required: ["address_id"],
			additionalProperties: false,
		},
		handler: (args) => clientAddresses.remove(args.address_id as string),
	},
	{
		name: "clients.addresses.restore",
		title: "Restore an address",
		description: "Bring a soft-deleted client address back. Fails if it was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { address_id: { type: "string", description: "The address row's id." } },
			required: ["address_id"],
			additionalProperties: false,
		},
		handler: (args) => clientAddresses.restore(args.address_id as string),
	},
	{
		name: "clients.addresses.set_primary",
		title: "Set the primary address",
		description:
			"Make this the client's primary address. The flag is cleared on every other address at the same client.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { address_id: { type: "string", description: "The address row's id." } },
			required: ["address_id"],
			additionalProperties: false,
		},
		handler: (args) => clientAddresses.setPrimary(args.address_id as string),
	},
];
