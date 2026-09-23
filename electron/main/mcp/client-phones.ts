import type { ClientPhoneInput, ClientPhonePatch } from "../../shared/types";
import * as clientPhones from "../services/client-phones";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	phone: "phone",
	label: "label",
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
		description: "Free text describing what this number is for, such as \"Kantoor\".",
	},
	is_primary: {
		type: "boolean",
		description: "Make this the client's primary phone number. Clears the flag on the others.",
	},
};

export const clientPhoneTools: ToolDescriptor[] = [
	{
		name: "clients.phones.list_for_client",
		title: "List a client's phone numbers",
		description: "List the phone numbers on file for one client, primary first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clientPhones.listForClient(args.client_id as string),
	},
	{
		name: "clients.phones.create",
		title: "Add a phone number",
		description:
			"Add a phone number to a client. The first one added becomes primary on its own; a later one only if is_primary is set.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "The client's id." },
				phone: { type: "string", description: "The phone number, as the client writes it." },
				...writableProperties,
			},
			required: ["client_id", "phone"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientPhones.create({ ...fields(args), clientId: args.client_id as string } as ClientPhoneInput),
	},
	{
		name: "clients.phones.update",
		title: "Update a phone number",
		description: "Change one or more fields on a client's phone number. Fields left out are untouched.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				phone_id: { type: "string", description: "The phone number row's id." },
				phone: { type: "string", description: "The phone number, as the client writes it." },
				...writableProperties,
			},
			required: ["phone_id"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientPhones.update(args.phone_id as string, fields(args) as ClientPhonePatch),
	},
	{
		name: "clients.phones.delete",
		title: "Remove a phone number",
		description:
			"Soft delete a client's phone number. The row stays in the database and can be restored with clients.phones.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { phone_id: { type: "string", description: "The phone number row's id." } },
			required: ["phone_id"],
			additionalProperties: false,
		},
		handler: (args) => clientPhones.remove(args.phone_id as string),
	},
	{
		name: "clients.phones.restore",
		title: "Restore a phone number",
		description: "Bring a soft-deleted client phone number back. Fails if it was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { phone_id: { type: "string", description: "The phone number row's id." } },
			required: ["phone_id"],
			additionalProperties: false,
		},
		handler: (args) => clientPhones.restore(args.phone_id as string),
	},
	{
		name: "clients.phones.set_primary",
		title: "Set the primary phone number",
		description:
			"Make this the client's primary phone number. The flag is cleared on every other number at the same client.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { phone_id: { type: "string", description: "The phone number row's id." } },
			required: ["phone_id"],
			additionalProperties: false,
		},
		handler: (args) => clientPhones.setPrimary(args.phone_id as string),
	},
];
