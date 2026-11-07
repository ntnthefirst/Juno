/**
 * The agent's view of pages. A page is a document of kind `page` (decision 61),
 * so it is found with documents.list and removed with documents.remove; what is
 * here is reading and writing its blocks.
 */
import * as pages from "../services/pages";
import type { PagePatch } from "../../shared/types";
import type { ToolDescriptor } from "./types";

const BLOCKS = {
	type: "array",
	description:
		"The page's blocks, in order. Each is { type, text } for type text, heading or bullet; { type: 'check', text, done } for a checklist line; " +
		"or { type: 'table', header: [..], rows: [[..]] }. Text may hold <b>, <i> and <u> and nothing else. An id is optional. The list replaces the whole page.",
	items: { type: "object" },
} as const;

const PAGE_ID = { type: "string", description: "The id of the page, from documents.list (sourceKind is page)." } as const;

export const pageTools: ToolDescriptor[] = [
	{
		name: "pages.get",
		title: "Read a page",
		description: "A page's record and its blocks. Fails when the id is a document that is not a page.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { page_id: PAGE_ID },
			required: ["page_id"],
			additionalProperties: false,
		},
		handler: (args) => pages.get(args.page_id as string),
	},
	{
		name: "pages.create",
		title: "Create a page",
		description:
			"Writes a new page, a document of kind page that can belong to a client, a project, both or nothing. A project with a client brings that client along.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "The title. Default Untitled page." },
				client_id: { type: ["string", "null"], description: "The id of the client, from clients.list." },
				project_id: { type: ["string", "null"], description: "The id of the project, from projects.list." },
				blocks: BLOCKS,
			},
			additionalProperties: false,
		},
		handler: (args) =>
			pages.create({
				...(typeof args.title === "string" ? { title: args.title } : {}),
				...("client_id" in args ? { clientId: args.client_id as string | null } : {}),
				...("project_id" in args ? { projectId: args.project_id as string | null } : {}),
				...("blocks" in args ? { blocks: args.blocks } : {}),
			}),
	},
	{
		name: "pages.update",
		title: "Change a page",
		description:
			"Changes a page's title, its blocks, or where it is kept. Fields left out are untouched; blocks replace the whole page.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				page_id: PAGE_ID,
				title: { type: "string", description: "The new title." },
				client_id: { type: ["string", "null"], description: "The id of the client. Null for none." },
				project_id: { type: ["string", "null"], description: "The id of the project. Null for none." },
				blocks: BLOCKS,
			},
			required: ["page_id"],
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: PagePatch = {};
			if (typeof args.title === "string") patch.title = args.title;
			if ("client_id" in args) patch.clientId = args.client_id as string | null;
			if ("project_id" in args) patch.projectId = args.project_id as string | null;
			if ("blocks" in args) patch.blocks = args.blocks;
			return pages.update(args.page_id as string, patch);
		},
	},
];
