import type { DocumentMoveInput, FilePreviewSource } from "../../shared/types";
import * as compare from "../services/document-compare";
import * as convert from "../services/document-convert";
import * as imports from "../services/document-import";
import * as fromMail from "../services/document-mail";
import * as organise from "../services/document-organise";
import * as preview from "../services/file-preview";
import type { ToolDescriptor } from "./types";

/**
 * Tools for documents as files (decisions 75 to 77 and 81): moving and copying
 * to another client or project, renaming, a preview as words and cells,
 * converting to PDF and keeping a mail attachment. There are no folders.
 *
 * Opening a file in another app has no tool. The agent operates the business,
 * not the window (mcp.md section 7).
 */

function optionalId(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	return value === null ? null : String(value);
}

function placeArgs(args: Record<string, unknown>): DocumentMoveInput {
	return {
		...(args.client_id !== undefined ? { clientId: optionalId(args.client_id) } : {}),
		...(args.project_id !== undefined ? { projectId: optionalId(args.project_id) } : {}),
	};
}

const PLACE_PROPERTIES = {
	client_id: { type: ["string", "null"], description: "The client to keep it under, or null." },
	project_id: {
		type: ["string", "null"],
		description: "The project to keep it under, or null. A project that has a client brings that client.",
	},
};

function previewSource(args: Record<string, unknown>): FilePreviewSource {
	if (args.version_id) return { kind: "version", versionId: String(args.version_id) };
	if (args.document_id) return { kind: "document", documentId: String(args.document_id) };
	if (args.attachment_id) return { kind: "attachment", attachmentId: String(args.attachment_id) };
	if (args.asset_id) return { kind: "asset", assetId: String(args.asset_id) };
	throw new Error("Name one of document_id, version_id, attachment_id or asset_id.");
}

export const documentFileTools: ToolDescriptor[] = [
	{
		name: "documents.move",
		title: "Move a document",
		description:
			"Keeps a document under another client or project, by the same rule as documents.link, and refuses " +
			"a title the new place already has. Only where it is kept changes.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Document id." }, ...PLACE_PROPERTIES },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => organise.move(String(args.id), placeArgs(args)),
	},
	{
		name: "documents.rename",
		title: "Rename a document",
		description:
			"Changes a document's title and nothing else; the files keep their names. Refused when another " +
			"document in the same place has that title.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, title: { type: "string", description: "The new title." } },
			required: ["id", "title"],
			additionalProperties: false,
		},
		handler: async (args) => organise.rename(String(args.id), String(args.title)),
	},
	{
		name: "documents.duplicate",
		title: "Duplicate a document",
		description:
			"Makes a new document from the newest version, in the same place, named '<title> (copy)'. The copy " +
			"has one version and none of the original's signatures. A page cannot be duplicated this way.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => organise.duplicate(String(args.id)),
	},
	{
		name: "documents.copy",
		title: "Copy a document to another place",
		description:
			"Makes a new document from the newest version under another client or project. It keeps its " +
			"title when that is free there, and is named '<title> (copy)' otherwise.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Document id." }, ...PLACE_PROPERTIES },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => organise.copyTo(String(args.id), placeArgs(args)),
	},
	{
		name: "documents.preview",
		title: "Read a file's content",
		description:
			"What a file says, without opening it: its name, size, type and date, and its words (a PDF, a Word " +
			"file, text) or its cells per sheet (a spreadsheet or a CSV), cut at a limit. A picture or any other " +
			"file gives its details only. Name one of document_id (its newest version), version_id, " +
			"attachment_id (a mail attachment) or asset_id (a project file).",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				document_id: { type: "string" },
				version_id: { type: "string", description: "From documents.list_versions." },
				attachment_id: { type: "string", description: "A mail attachment's id." },
				asset_id: { type: "string", description: "A project file's id." },
			},
			additionalProperties: false,
		},
		handler: async (args) => preview.previewForAgent(previewSource(args)),
	},
	{
		name: "documents.compare",
		title: "Compare a version with another file",
		description:
			"Which words two files share and which the second adds or leaves out, word by word, as runs of same, " +
			"added and removed, with the counts. Use it to see why documents.find_matches says a file is nearly the " +
			"same as a document. Compares a version (version_id, from documents.list_versions) with another version " +
			"(other_version_id) or with a file on this machine (source_path). Reads PDF, Word, spreadsheet and text " +
			"files; unreadable names the side with no words to read, such as a scan. Writes nothing.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				version_id: { type: "string", description: "The version kept in Juno. Removed words are in it." },
				other_version_id: { type: "string", description: "Another version to compare with. Added words are in it." },
				source_path: { type: "string", description: "Instead of other_version_id: absolute path to a file on this machine." },
			},
			required: ["version_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			compare.compareForAgent({
				versionId: String(args.version_id),
				...(typeof args.other_version_id === "string" ? { otherVersionId: args.other_version_id } : {}),
				...(typeof args.source_path === "string" ? { sourcePath: args.source_path } : {}),
			}),
	},
	{
		name: "documents.convert_pdf",
		title: "Make a PDF of a document",
		description:
			"Converts the newest version of a document that is not a PDF (a Word file, a spreadsheet, text, a " +
			"picture) and keeps the PDF as its next version; the original stays. Microsoft Word does it when it " +
			"is installed and keeps the layout; otherwise Juno does, and via is juno, which means the layout may " +
			"differ. A document must be a PDF to be signed.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Document id." } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => convert.convertToPdf(String(args.id)),
	},
	{
		name: "documents.import_from_mail",
		title: "Keep a mail attachment as a document",
		description:
			"Keeps an attachment of a received mail, any kind of file, as a document. With version_of it is " +
			"added as the next version of that document instead. Call documents.find_matches_in_mail first to " +
			"see whether it looks like a document already kept. Without a place it is kept under the client the " +
			"conversation is linked to.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				attachment_id: { type: "string", description: "The attachment's id, from mail.messages.get." },
				version_of: { type: ["string", "null"], description: "A document to add it to as a version." },
				title: { type: "string", description: "Defaults to the file's name without its extension." },
				...PLACE_PROPERTIES,
			},
			required: ["attachment_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			imports.importFromMail({
				attachmentId: String(args.attachment_id),
				versionOf: optionalId(args.version_of) ?? null,
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...placeArgs(args),
			}),
	},
	{
		name: "documents.import_from_thread",
		title: "Keep a conversation's attachments as documents",
		description:
			"Keeps the attachments of a received conversation as documents in one call. Without a place they go " +
			"to the project the conversation is filed under, or else its client; a conversation filed under " +
			"neither needs a place. Each file is checked like a drop: one whose bytes are already a version " +
			"comes back skipped, one that looks like a document already kept (its words or its name) comes " +
			"back as review with that document and is not saved, so decide it with documents.import_from_mail " +
			"(with or without version_of), and anything else is saved. With link_conversation the conversation " +
			"is filed under that project, or linked to that client, in the same call.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				thread_id: { type: "string", description: "The conversation's id, from mail.threads.list." },
				attachment_ids: {
					type: "array",
					items: { type: "string" },
					description:
						"Some of its attachments, from mail.threads.get. Left out, every attachment that is not a document yet.",
				},
				link_conversation: {
					type: "boolean",
					description: "Also file the conversation under the project (or link it to the client) the files go to.",
				},
				...PLACE_PROPERTIES,
			},
			required: ["thread_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			fromMail.saveFromThread({
				threadId: String(args.thread_id),
				...(Array.isArray(args.attachment_ids) ? { attachmentIds: args.attachment_ids.map(String) } : {}),
				...(args.link_conversation !== undefined ? { linkThread: args.link_conversation === true } : {}),
				...placeArgs(args),
			}),
	},
	{
		name: "documents.list_from_thread",
		title: "List a conversation's attachments and the documents they are",
		description:
			"Every attachment of a conversation, each with the document it already is (by its bytes) or null, and " +
			"place: where documents.import_from_thread would put the rest. place.linked is false when the " +
			"conversation is filed under nothing and the place is only the project the mail suggestions point " +
			"at; place is null when there is not even that. Writes nothing.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { thread_id: { type: "string", description: "The conversation's id, from mail.threads.list." } },
			required: ["thread_id"],
			additionalProperties: false,
		},
		handler: async (args) => fromMail.forThread(String(args.thread_id)),
	},
	{
		name: "documents.find_matches_in_mail",
		title: "Find documents a mail attachment matches",
		description:
			"Reads a mail attachment and lists the documents it looks like, each with its reason: the same bytes, " +
			"the same words (a signed or re-saved copy), or the same name in the place it is going to. Writes " +
			"nothing. Use it before documents.import_from_mail to decide between a new version and a new document.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { attachment_id: { type: "string" }, ...PLACE_PROPERTIES },
			required: ["attachment_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			imports.analyseImport({
				source: { kind: "attachment", attachmentId: String(args.attachment_id) },
				...placeArgs(args),
			}),
	},
];
