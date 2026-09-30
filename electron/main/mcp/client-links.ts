import { CLIENT_LINK_KINDS } from "../../shared/client-links";
import type { ClientLinkInput, ClientLinkPatch } from "../../shared/types";
import * as clientLinks from "../services/client-links";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	url: "url",
	kind: "kind",
	label: "label",
} as const;

function fields(args: Record<string, unknown>): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [argument, column] of Object.entries(FIELDS)) {
		if (argument in args) mapped[column] = args[argument];
	}
	return mapped;
}

const writableProperties: Record<string, unknown> = {
	url: {
		type: "string",
		description: "The address, such as https://www.linkedin.com/company/hyge. A missing https:// is added.",
	},
	kind: {
		type: "string",
		enum: [...CLIENT_LINK_KINDS],
		description: "What the link is. Left out on create, it is guessed from the address.",
	},
	label: {
		type: ["string", "null"],
		description: "Free text such as \"Company page\" or \"Founder\". Empty shows the kind.",
	},
};

export const clientLinkTools: ToolDescriptor[] = [
	{
		name: "clients.links.list_for_client",
		title: "List a client's links",
		description: "List the websites and social profiles on file for one client, oldest first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "The client's id." } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: (args) => clientLinks.listForClient(args.client_id as string),
	},
	{
		name: "clients.links.create",
		title: "Add a link to a client",
		description: "Add a website or social profile to a client. Only http and https addresses are accepted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "The client's id." },
				...writableProperties,
			},
			required: ["client_id", "url"],
			additionalProperties: false,
		},
		handler: (args) =>
			clientLinks.create({ ...fields(args), clientId: args.client_id as string } as ClientLinkInput),
	},
	{
		name: "clients.links.update",
		title: "Update a client's link",
		description: "Change one or more fields on a client's link. Fields left out are untouched.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				link_id: { type: "string", description: "The link row's id." },
				...writableProperties,
			},
			required: ["link_id"],
			additionalProperties: false,
		},
		handler: (args) => clientLinks.update(args.link_id as string, fields(args) as ClientLinkPatch),
	},
	{
		name: "clients.links.delete",
		title: "Remove a client's link",
		description:
			"Soft delete a client's link. The row stays in the database and can be restored with clients.links.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { link_id: { type: "string", description: "The link row's id." } },
			required: ["link_id"],
			additionalProperties: false,
		},
		handler: (args) => clientLinks.remove(args.link_id as string),
	},
	{
		name: "clients.links.restore",
		title: "Restore a client's link",
		description: "Bring a soft-deleted client link back. Fails if it was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { link_id: { type: "string", description: "The link row's id." } },
			required: ["link_id"],
			additionalProperties: false,
		},
		handler: (args) => clientLinks.restore(args.link_id as string),
	},
];
