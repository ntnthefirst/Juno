/**
 * The agent's view of a project.
 *
 * It can read and write the records: the project, the places it lives, and the
 * files attached to it. It cannot write or run a command, and there is
 * deliberately no tool that does either (decision 35). A command is a raw shell
 * statement, which .claude/rules/mcp.md section 7 says a tool does not take,
 * and a pair of tools that writes one and runs one is a remote shell with an
 * approval dialog in front of it asking a person to read a command line and
 * guess. `projects.list_commands` is read-only so an agent can still say what a
 * project is started with.
 */
import type {
	ProjectAssetPatch,
	ProjectInput,
	ProjectLinkInput,
	ProjectLinkPatch,
	ProjectPatch,
} from "../../shared/types";
import * as assets from "../services/project-assets";
import * as commands from "../services/project-commands";
import * as links from "../services/project-links";
import * as projects from "../services/projects";
import type { ToolDescriptor } from "./types";

const FIELDS = {
	name: "name",
	client_id: "clientId",
	status_id: "statusId",
	description: "description",
	starts_on: "startsOn",
	due_on: "dueOn",
	agreed_value_cents: "agreedValueCents",
	notes: "notes",
	local_path: "localPath",
} as const;

function fields(args: Record<string, unknown>): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [argument, column] of Object.entries(FIELDS)) {
		if (argument in args) mapped[column] = args[argument];
	}
	return mapped;
}

const writableProperties: Record<string, unknown> = {
	client_id: {
		type: ["string", "null"],
		description:
			"Id of the client this work is for. Null for work that is not for a client, which is allowed.",
	},
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
	local_path: {
		type: ["string", "null"],
		description:
			"Full path to the project's folder on this machine. The folder has to exist. Juno reads it and never writes to it.",
	},
};

const LINK_KINDS = ["github", "figma", "website", "design", "docs", "folder", "other"];

export const projectTools: ToolDescriptor[] = [
	{
		name: "projects.list",
		title: "List projects",
		description:
			"List projects with the client name and status resolved, plus how many files, links and commands each one has. Filter by client, by status, or to the projects with no client at all.",
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
				unassigned: {
					type: "boolean",
					description:
						"True lists only the projects that belong to no client. False lists only those that belong to one.",
				},
			},
			additionalProperties: false,
		},
		handler: (args) =>
			projects.list({
				clientId: args.client_id as string | undefined,
				statusId: args.status_id as string | null | undefined,
				unassigned: args.unassigned as boolean | undefined,
			}),
	},
	{
		name: "projects.get",
		title: "Get a project",
		description:
			"Read one project by id. Returns null when the project does not exist or was deleted.",
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
			"Create a project. It may belong to a client, and need not: work a business does for itself is a project too. Find a client id with clients.list first; this tool does not resolve names.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Short name for the piece of work." },
				...writableProperties,
			},
			required: ["name"],
			additionalProperties: false,
		},
		handler: (args) => projects.create(fields(args) as ProjectInput),
	},
	{
		name: "projects.update",
		title: "Update a project",
		description:
			"Change one or more fields on a project. Fields left out are untouched; pass null to clear one. Where the project keeps its files is not a field here: it moves them, so it belongs to a person in the app.",
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
			"Soft delete a project. The row stays in the database and can be restored with projects.restore. Its files stay on disk either way.",
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
	{
		name: "projects.get_storage",
		title: "Where a project keeps its files",
		description:
			"The folder a project's own files are kept in, whether it is the app's folder or one the owner chose, and how much is in it. Read-only: moving the folder copies files, so it is done by a person in the app.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => projects.storage(args.project_id as string),
	},

	{
		name: "projects.list_links",
		title: "List a project's links",
		description:
			"The places a project lives that are not files: repositories, design files, staging addresses, folders on this machine.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => links.listForProject(args.project_id as string),
	},
	{
		name: "projects.create_link",
		title: "Add a link to a project",
		description:
			"Add a place the project lives. The target is an https address or the full path to a folder on this machine. Other protocols are refused, because a link opens in the browser.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "The project's id." },
				label: { type: "string", description: "What to call it: Repository, Designs, Staging." },
				target: {
					type: "string",
					description:
						"An https address, or the full path to a folder on this machine. Nothing else.",
				},
				kind: {
					type: "string",
					enum: LINK_KINDS,
					description: "Picks the icon. Left out, it is worked out from the target.",
				},
				notes: { type: ["string", "null"], description: "Anything worth saying about it." },
			},
			required: ["project_id", "label", "target"],
			additionalProperties: false,
		},
		handler: (args) =>
			links.create({
				projectId: args.project_id as string,
				label: args.label as string,
				target: args.target as string,
				kind: args.kind as ProjectLinkInput["kind"],
				notes: (args.notes as string | null | undefined) ?? null,
			}),
	},
	{
		name: "projects.update_link",
		title: "Change a project's link",
		description: "Change the name, target, kind or notes of one link. Fields left out are untouched.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				link_id: { type: "string", description: "The link's id, from projects.list_links." },
				label: { type: "string", description: "What to call it." },
				target: { type: "string", description: "An https address, or a full folder path." },
				kind: { type: "string", enum: LINK_KINDS, description: "Picks the icon." },
				notes: { type: ["string", "null"], description: "Anything worth saying about it." },
			},
			required: ["link_id"],
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: ProjectLinkPatch = {};
			if ("label" in args) patch.label = args.label as string;
			if ("target" in args) patch.target = args.target as string;
			if ("kind" in args) patch.kind = args.kind as ProjectLinkPatch["kind"];
			if ("notes" in args) patch.notes = args.notes as string | null;
			return links.update(args.link_id as string, patch);
		},
	},
	{
		name: "projects.delete_link",
		title: "Remove a project's link",
		description: "Soft delete one link. The thing it pointed at is not touched.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { link_id: { type: "string", description: "The link's id." } },
			required: ["link_id"],
			additionalProperties: false,
		},
		handler: (args) => links.remove(args.link_id as string),
	},

	{
		name: "projects.list_assets",
		title: "List a project's files",
		description:
			"The files attached to a project, with their size, kind and where each one actually is. A managed file was copied into the project's folder; a linked one stayed where it was. This returns the records, never the contents.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => assets.listForProject(args.project_id as string),
	},
	{
		name: "projects.update_asset",
		title: "Rename or caption a project file",
		description:
			"Change the name a file is shown under, or its caption. The file on disk keeps the name it was saved with. Adding a file is not a tool: it picks one from this machine, which is a person's job.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				asset_id: { type: "string", description: "The file's id, from projects.list_assets." },
				file_name: { type: "string", description: "What to call it on screen." },
				caption: { type: ["string", "null"], description: "A line saying what it shows." },
			},
			required: ["asset_id"],
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: ProjectAssetPatch = {};
			if ("file_name" in args) patch.fileName = args.file_name as string;
			if ("caption" in args) patch.caption = args.caption as string | null;
			return assets.update(args.asset_id as string, patch);
		},
	},
	{
		name: "projects.delete_asset",
		title: "Remove a file from a project",
		description:
			"Soft delete the record. The file itself stays on disk, so this can be undone in the app; a linked file is never touched at all.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { asset_id: { type: "string", description: "The file's id." } },
			required: ["asset_id"],
			additionalProperties: false,
		},
		handler: (args) => assets.remove(args.asset_id as string),
	},
	{
		name: "projects.set_cover",
		title: "Pick the image shown on a project's card",
		description:
			"Choose which of a project's images the card shows. Pass null to go back to the first one.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "The project's id." },
				asset_id: {
					type: ["string", "null"],
					description: "An image belonging to this project, or null to clear the choice.",
				},
			},
			required: ["project_id", "asset_id"],
			additionalProperties: false,
		},
		handler: (args) =>
			projects.setCover(args.project_id as string, args.asset_id as string | null),
	},

	{
		name: "projects.list_commands",
		title: "List a project's commands",
		description:
			"What a project is started with: the label, the command line and the folder it runs in. Read-only, and it is the only command tool there is. Writing or running one is a person's job in the app, because a command runs in a real shell with the owner's privileges.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The project's id." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => commands.listForProject(args.project_id as string),
	},
];
