import type { ClientEmailInput, ClientEmailPatch } from "../../shared/types";
import * as clientEmails from "../services/client-emails";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	email: "email",
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
		description: "Free text describing what this address is for, such as \"Facturatie\".",
	},
	is_primary: {
		type: "boolean",
		description: "Make this the client's primary email. Clears the flag on the others.",
	},
};

export const clientEmailTools: ToolDescriptor[] = [
	{
		name: "clients.emails.list_for_client",
		title: "List a client's email addresses",
		description: "List the email addresses on file for one client, primary first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clientEmails.listForClient(args.client_id as string),
	},
	{
		name: "clients.emails.create",
		title: "Add an email address",
		description:
			"Add an email address to a client. The first one added becomes primary on its own; a later one only if is_primary is set.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "The client's id." },
				email: { type: "string", description: "The email address." },
				...writableProperties,
			},
			required: ["client_id", "email"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientEmails.create({ ...fields(args), clientId: args.client_id as string } as ClientEmailInput),
	},
	{
		name: "clients.emails.update",
		title: "Update an email address",
		description: "Change one or more fields on a client's email address. Fields left out are untouched.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				email_id: { type: "string", description: "The email address row's id." },
				email: { type: "string", description: "The email address." },
				...writableProperties,
			},
			required: ["email_id"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientEmails.update(args.email_id as string, fields(args) as ClientEmailPatch),
	},
	{
		name: "clients.emails.delete",
		title: "Remove an email address",
		description:
			"Soft delete a client's email address. The row stays in the database and can be restored with clients.emails.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { email_id: { type: "string", description: "The email address row's id." } },
			required: ["email_id"],
			additionalProperties: false,
		},
		handler: (args) => clientEmails.remove(args.email_id as string),
	},
	{
		name: "clients.emails.restore",
		title: "Restore an email address",
		description: "Bring a soft-deleted client email address back. Fails if it was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { email_id: { type: "string", description: "The email address row's id." } },
			required: ["email_id"],
			additionalProperties: false,
		},
		handler: (args) => clientEmails.restore(args.email_id as string),
	},
	{
		name: "clients.emails.set_primary",
		title: "Set the primary email address",
		description:
			"Make this the client's primary email address. The flag is cleared on every other email at the same client.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { email_id: { type: "string", description: "The email address row's id." } },
			required: ["email_id"],
			additionalProperties: false,
		},
		handler: (args) => clientEmails.setPrimary(args.email_id as string),
	},
];
