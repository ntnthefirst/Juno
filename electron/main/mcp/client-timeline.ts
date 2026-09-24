import type { ClientNoteKind, ClientTimelineKind } from "../../shared/types";
import * as timeline from "../services/client-timeline";
import type { ToolDescriptor } from "./types";

/**
 * A client's history, and the notes a person writes into it.
 *
 * `clients.timeline` is the tool to reach for before answering anything about
 * what has happened with a client. It is one call over six tables, so the
 * alternative is four list calls and a guess at the order.
 *
 * Notes are the only writable part. Everything else in the stream belongs to
 * the record it came from and is changed there: a document's status through
 * documents.set_status, an appointment through calendar.update_event.
 */

const KINDS: ClientTimelineKind[] = ["note", "mail", "document", "event", "reminder", "project"];
const NOTE_KINDS: ClientNoteKind[] = ["note", "call", "meeting"];

export const clientTimelineTools: ToolDescriptor[] = [
	{
		name: "clients.timeline",
		title: "Read a client's history",
		description:
			"What has happened with one client, newest first, across mail threads, documents, " +
			"appointments, reminders, projects and written notes. Each entry carries `at` as a UTC " +
			"instant and, when the record underneath is a date with no time, `on` as a plain " +
			"YYYY-MM-DD. Use `on` when it is there: converting it to a local date moves a deadline " +
			"by a day for half the year.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string" },
				kinds: {
					type: "array",
					items: { type: "string", enum: KINDS },
					description: "Left out means every kind.",
				},
				limit: { type: "integer", minimum: 1, maximum: 300, description: "Default 60." },
				before: {
					type: "string",
					description: "UTC ISO-8601. Only entries older than this, for the next page.",
				},
			},
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			timeline.timeline({
				clientId: String(args.client_id),
				...(Array.isArray(args.kinds) ? { kinds: args.kinds as ClientTimelineKind[] } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
				...(args.before !== undefined ? { before: String(args.before) } : {}),
			}),
	},
	{
		name: "clients.notes.list",
		title: "List a client's notes",
		description: "Every note written by hand about one client, newest first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string" } },
			required: ["client_id"],
			additionalProperties: false,
		},
		handler: async (args) => timeline.listNotes(String(args.client_id)),
	},
	{
		name: "clients.notes.create",
		title: "Write a note on a client",
		description:
			"Records something that left no other trace, a phone call above all. `happened_at` is " +
			"when it happened and defaults to now: a call being written up on Friday still belongs " +
			"on Tuesday, and the timeline sorts on that rather than on when the row was written.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string" },
				title: { type: "string", description: "One line saying what happened." },
				kind: { type: "string", enum: NOTE_KINDS, description: "Default note." },
				happened_at: { type: "string", description: "UTC ISO-8601. Defaults to now." },
				body: { type: "string", description: "The detail, as Markdown." },
			},
			required: ["client_id", "title"],
			additionalProperties: false,
		},
		handler: async (args) =>
			timeline.createNote({
				clientId: String(args.client_id),
				title: String(args.title),
				...(args.kind !== undefined ? { kind: args.kind as ClientNoteKind } : {}),
				...(args.happened_at !== undefined ? { happenedAt: String(args.happened_at) } : {}),
				...(args.body !== undefined ? { body: String(args.body) } : {}),
			}),
	},
	{
		name: "clients.notes.update",
		title: "Edit a note",
		description: "Changes a note's line, its detail, its kind or when it happened.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				title: { type: "string" },
				kind: { type: "string", enum: NOTE_KINDS },
				happened_at: { type: "string", description: "UTC ISO-8601." },
				body: { type: "string" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			timeline.updateNote(String(args.id), {
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.kind !== undefined ? { kind: args.kind as ClientNoteKind } : {}),
				...(args.happened_at !== undefined ? { happenedAt: String(args.happened_at) } : {}),
				...(args.body !== undefined ? { body: String(args.body) } : {}),
			}),
	},
	{
		name: "clients.notes.delete",
		title: "Remove a note",
		description: "Soft-deletes a note. It leaves the timeline and can be restored.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => timeline.removeNote(String(args.id)),
	},
	{
		name: "clients.notes.restore",
		title: "Put a removed note back",
		description: "Undoes clients.notes.delete.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => timeline.restoreNote(String(args.id)),
	},
];
