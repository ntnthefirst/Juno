/**
 * The agent's view of notes. Reading and writing a note touches this machine
 * and nothing else; deleting one parks for approval like every other delete.
 */
import * as notes from "../services/notes";
import type { NoteInput, NotePatch } from "../../shared/types";
import type { ToolDescriptor } from "./types";

const TITLE = { type: "string", description: "The title. May be empty, and the list then shows the first line." } as const;
const BODY = {
	type: "string",
	description: "The text, as Markdown. A checklist is lines like '- [ ] Order screws' and '- [x] Sharpen the chisels'.",
} as const;
const CLIENT = { type: ["string", "null"], description: "The id of the client it belongs to, from clients.list. Null for none." } as const;
const PROJECT = { type: ["string", "null"], description: "The id of the project it belongs to, from projects.list. Null for none." } as const;
const NOTE_ID = { type: "string", description: "The id of the note, from notes.list." } as const;
const MANY_IDS: Record<string, unknown> = {
	type: "object",
	properties: {
		note_ids: {
			type: "array",
			items: { type: "string" },
			minItems: 1,
			maxItems: 500,
			description: "The notes' ids, from notes.list. At most 500.",
		},
	},
	required: ["note_ids"],
	additionalProperties: false,
};

function fields(args: Record<string, unknown>): NoteInput {
	const input: NoteInput = {};
	if (typeof args.title === "string") input.title = args.title;
	if (typeof args.body === "string") input.body = args.body;
	if ("client_id" in args) input.clientId = args.client_id as string | null;
	if ("project_id" in args) input.projectId = args.project_id as string | null;
	return input;
}

function scope(args: Record<string, unknown>) {
	return {
		...(typeof args.client_id === "string" ? { clientId: args.client_id } : {}),
		...(typeof args.project_id === "string" ? { projectId: args.project_id } : {}),
		...(typeof args.limit === "number" ? { limit: args.limit } : {}),
		...(typeof args.offset === "number" ? { offset: args.offset } : {}),
	};
}

export const noteTools: ToolDescriptor[] = [
	{
		name: "notes.list",
		title: "List notes",
		description:
			"Notes, pinned ones first and then the most recently edited. Each has its title, its Markdown body and the client and project it belongs to. " +
			"Takes a client or a project to see only theirs, and a limit (default 200, at most 1000).",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "Only the notes of this client." },
				project_id: { type: "string", description: "Only the notes of this project." },
				limit: { type: "integer", description: "At most this many." },
				offset: { type: "integer", minimum: 0, description: "Notes to skip, for the next page." },
			},
			additionalProperties: false,
		},
		handler: (args) => notes.list(scope(args)),
	},
	{
		name: "notes.get",
		title: "Read a note",
		description: "One note by id. Returns null when it does not exist or was deleted.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { note_id: NOTE_ID },
			required: ["note_id"],
			additionalProperties: false,
		},
		handler: (args) => notes.get(args.note_id as string),
	},
	{
		name: "notes.search",
		title: "Search notes",
		description:
			"Notes whose title or text holds every word given, the last one as a prefix, best match first, each with the words around the match.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "The words to look for." },
				client_id: { type: "string", description: "Only the notes of this client." },
				project_id: { type: "string", description: "Only the notes of this project." },
				limit: { type: "integer", description: "At most this many. Default 50." },
			},
			required: ["query"],
			additionalProperties: false,
		},
		handler: (args) => notes.search(args.query as string, scope(args)),
	},
	{
		name: "notes.create",
		title: "Create a note",
		description: "Writes a new note. Every field is optional, so an empty call makes an empty note.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { title: TITLE, body: BODY, client_id: CLIENT, project_id: PROJECT },
			additionalProperties: false,
		},
		handler: (args) => notes.create(fields(args)),
	},
	{
		name: "notes.update",
		title: "Change a note",
		description:
			"Changes the title, the body, the client or the project of a note, or pins it to the top of the list. Fields left out are untouched, and a body replaces the whole text.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				note_id: NOTE_ID,
				title: TITLE,
				body: BODY,
				client_id: CLIENT,
				project_id: PROJECT,
				pinned: { type: "boolean", description: "True pins it to the top of the list, false unpins it." },
			},
			required: ["note_id"],
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: NotePatch = fields(args);
			if (typeof args.pinned === "boolean") patch.pinned = args.pinned;
			return notes.update(args.note_id as string, patch);
		},
	},
	{
		name: "notes.duplicate",
		title: "Copy a note",
		description: "Makes a copy of a note, titled as a copy and not pinned.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { note_id: NOTE_ID },
			required: ["note_id"],
			additionalProperties: false,
		},
		handler: (args) => notes.duplicate(args.note_id as string),
	},
	{
		name: "notes.delete",
		title: "Delete a note",
		description: "Soft delete a note. The row stays in the database and can be brought back with notes.restore.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { note_id: NOTE_ID },
			required: ["note_id"],
			additionalProperties: false,
		},
		handler: (args) => notes.remove(args.note_id as string),
	},
	{
		name: "notes.restore",
		title: "Restore a note",
		description: "Brings a deleted note back. Fails when the note was never deleted.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { note_id: NOTE_ID },
			required: ["note_id"],
			additionalProperties: false,
		},
		handler: (args) => notes.restore(args.note_id as string),
	},
	{
		name: "notes.duplicate_many",
		title: "Copy several notes",
		description:
			"Make a copy of each note, in one go, each titled as a copy and not pinned. A deleted note is left alone. Every id must be a note's, or nothing is copied. Returns the copies.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: MANY_IDS,
		prepare: async (args) => notes.reviewMany("duplicate", args.note_ids as string[]),
		handler: (args) => notes.duplicateMany(args.note_ids as string[]),
	},
	{
		name: "notes.delete_many",
		title: "Delete several notes",
		description:
			"Soft delete each note, in one go, as one request listing every note. A note already deleted is left alone. Every id must be a note's, or nothing changes. Undo with notes.restore_many.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: MANY_IDS,
		prepare: async (args) => notes.reviewMany("delete", args.note_ids as string[]),
		handler: (args) => notes.removeMany(args.note_ids as string[]),
	},
	{
		name: "notes.restore_many",
		title: "Restore several notes",
		description:
			"Bring each deleted note back, in one go. A note that is not deleted is left alone. Every id must be a note's, or nothing changes.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: MANY_IDS,
		prepare: async (args) => notes.reviewMany("restore", args.note_ids as string[]),
		handler: (args) => notes.restoreMany(args.note_ids as string[]),
	},
];
