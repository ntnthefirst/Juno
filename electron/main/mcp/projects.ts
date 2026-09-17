import type { ProjectInput, ProjectPatch } from "../../shared/types";
import * as projects from "../services/projects";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	name: "name",
	status_id: "statusId",
	description: "description",
	starts_on: "startsOn",
	due_on: "dueOn",
	agreed_value_cents: "agreedValueCents",
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
		description: "Id of an item in the project_status reference set.",
	},
	description: { type: ["string", "null"], description: "What the work is." },
	starts_on: {
		type: ["string", "null"],
		description: "Start date as YYYY-MM-DD. A calendar date, not a timestamp.",
	},
	due_on: {
		type: ["string", "null"],
		description: "Due date as YYYY-MM-DD. A calendar date, not a timestamp.",
	},
	agreed_value_cents: {
		type: ["integer", "null"],
		description: "Agreed value in whole euro cents. 1250,00 EUR is 125000.",
	},
	notes: { type: ["string", "null"], description: "Free text notes about the project." },
};

export const projectTools: ToolDescriptor[] = [
	{
		name: "projects.list",
		title: "List projects",
		description:
			"List projects with the client name and status resolved. Filter by client or by status.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "Only projects for this client." },
				status_id: {
					type: ["string", "null"],
					description: "Only projects with this status. Null means projects with no status.",
				},
			},
			additionalProperties: false,
		},
		handler: (args) =>
			projects.list({
				clientId: args.client_id as string | undefined,
				statusId: args.status_id as string | null | undefined,
			}),
	},
	{
		name: "projects.get",
		title: "Get a project",
		description: "Read one project by id. Returns null when the project does not exist or was deleted.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => projects.get(args.project_id as string),
	},
	{
		name: "projects.create",
		title: "Create a project",
		description:
			"Create a project for a client. Find the client id with clients.list first; this tool does not resolve names.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "Id of the client this work is for." },
				name: { type: "string", description: "Short name for the piece of work." },
				...writableProperties,
			},
			required: ["client_id", "name"],
			additionalProperties: false,
		},
		handler: (args) =>
			projects.create({
				...fields(args),
				clientId: args.client_id as string,
			} as ProjectInput),
	},
	{
		name: "projects.update",
		title: "Update a project",
		description:
			"Change one or more fields on a project. Fields left out are untouched; pass null to clear one. A project cannot be moved to another client.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "The project's id." },
				name: { type: "string", description: "Short name for the piece of work." },
				...writableProperties,
			},
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => projects.update(args.project_id as string, fields(args) as ProjectPatch),
	},
	{
		name: "projects.delete",
		title: "Delete a project",
		description:
			"Soft delete a project. The row stays in the database and can be restored with projects.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => projects.remove(args.project_id as string),
	},
	{
		name: "projects.restore",
		title: "Restore a project",
		description: "Bring a soft-deleted project back. Fails if the project was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => projects.restore(args.project_id as string),
	},
];
