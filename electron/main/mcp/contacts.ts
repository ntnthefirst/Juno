import type { ContactInput, ContactPatch } from "../../shared/types";
import * as contacts from "../services/contacts";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	name: "name",
	role: "role",
	email: "email",
	phone: "phone",
	is_primary: "isPrimary",
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
	role: { type: ["string", "null"], description: "Job title or role at the client." },
	email: { type: ["string", "null"], description: "Email address for this person." },
	phone: { type: ["string", "null"], description: "Telephone number for this person." },
	is_primary: {
		type: "boolean",
		description: "Make this the client's primary contact. Clears the flag on the others.",
	},
	notes: { type: ["string", "null"], description: "Free text notes about this person." },
};

export const contactTools: ToolDescriptor[] = [
	{
		name: "contacts.list_for_client",
		title: "List contacts for a client",
		description: "List the people at one client, primary contact first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => contacts.listForClient(args.client_id as string),
	},
	{
		name: "contacts.create",
		title: "Create a contact",
		description:
			"Add a person to a client. Find the client id with clients.list first; this tool does not resolve names.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "Id of the client this person works for." },
				name: { type: "string", description: "The person's full name." },
				...writableProperties,
			},
			required: ["client_id", "name"],
			additionalProperties: false,
		},
		handler: (args) =>
			contacts.create({
				...fields(args),
				clientId: args.client_id as string,
			} as ContactInput),
	},
	{
		name: "contacts.update",
		title: "Update a contact",
		description:
			"Change one or more fields on a contact. Fields left out are untouched; pass null to clear one. A contact cannot be moved to another client.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				contact_id: { type: "string", description: "The contact's id." },
				name: { type: "string", description: "The person's full name." },
				...writableProperties,
			},
			required: ["contact_id"],
			additionalProperties: false,
		},
		handler: (args) => contacts.update(args.contact_id as string, fields(args) as ContactPatch),
	},
	{
		name: "contacts.delete",
		title: "Delete a contact",
		description:
			"Soft delete a contact. The row stays in the database and can be restored with contacts.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { contact_id: { type: "string", description: "The contact's id." } },
			required: ["contact_id"],
			additionalProperties: false,
		},
		handler: (args) => contacts.remove(args.contact_id as string),
	},
	{
		name: "contacts.restore",
		title: "Restore a contact",
		description: "Bring a soft-deleted contact back. Fails if the contact was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { contact_id: { type: "string", description: "The contact's id." } },
			required: ["contact_id"],
			additionalProperties: false,
		},
		handler: (args) => contacts.restore(args.contact_id as string),
	},
	{
		name: "contacts.set_primary",
		title: "Set the primary contact",
		description:
			"Make this contact the client's primary one. The flag is cleared on every other contact at the same client.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { contact_id: { type: "string", description: "The contact's id." } },
			required: ["contact_id"],
			additionalProperties: false,
		},
		handler: (args) => contacts.setPrimary(args.contact_id as string),
	},
];
