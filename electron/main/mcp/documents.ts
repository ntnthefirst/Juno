import type { ImportDocumentInput } from "../../shared/types";
import * as actions from "../services/document-actions";
import * as imports from "../services/document-import";
import * as timeline from "../services/document-timeline";
import * as versions from "../services/document-versions";
import * as working from "../services/document-working";
import * as documents from "../services/documents";
import type { ToolDescriptor } from "./types";

/**
 * Tools for documents.
 *
 * **Nothing signs, and nothing touches the certificate.** `documents.sign` and
 * the signing certificate exist in the interface only. The service refuses a
 * specimen regardless, but signing is a person's act: placing the stamp and
 * typing the certificate passphrase are things somebody at the keyboard does.
 */

const OWNER_RULE =
	"A document belongs to a client, a project, both, or neither. A project that has a client brings " +
	"that client along; naming a different client is refused.";

export const documentTools: ToolDescriptor[] = [
	{
		name: "documents.list",
		title: "List documents",
		description: "Documents, newest first, optionally for one client or one project.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string", description: "Limit to one client." },
				project_id: { type: "string", description: "Limit to one project." },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			documents.list({
				...(args.client_id ? { clientId: String(args.client_id) } : {}),
				...(args.project_id ? { projectId: String(args.project_id) } : {}),
			}),
	},
	{
		name: "documents.list_unfiled",
		title: "List the owner's own files",
		description:
			"Documents kept under no client and no project, newest first: the owner's own files, listed in Files " +
			"on the rail (a spreadsheet, the terms and conditions, a logo). Give one a client or a project with " +
			"documents.link or documents.move.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => documents.listUnfiled(),
	},
	{
		name: "documents.link",
		title: "Keep a document under a client or a project",
		description:
			"Changes what a document belongs to: a client, a project, both, or neither (pass null for both). " +
			"A project that has a client brings that client along, and naming a different client is refused. " +
			"Only where it is kept changes; the file, its versions and its signatures stay as they are.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				client_id: { type: ["string", "null"], description: "Null for no client." },
				project_id: { type: ["string", "null"], description: "Null for no project." },
			},
			required: ["id", "client_id", "project_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			documents.link(String(args.id), {
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
			}),
	},
	{
		name: "documents.get",
		title: "Read a document",
		description: "One document, including the body as it was rendered.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => working.getChecked(String(args.id)),
	},
	{
		name: "documents.import",
		title: "Import a file as a document",
		description:
			"Copies an existing file of any kind on this machine (a PDF, a Word file, a spreadsheet, a picture) " +
			"into Juno and records it under a client, a project or both, the Documents tab it is listed on. One " +
			"kept under neither is listed in Files, the owner's own. It has no body " +
			"and cannot be rendered again, because it did not come from a template. A PDF can be signed; any " +
			"other kind is converted with documents.convert_pdf first. " +
			"Refused when the same client, or project when there is no client, already has a document with the " +
			"same title: check documents.find_matches first.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				source_path: { type: "string", description: "Absolute path to the file on this machine." },
				client_id: { type: ["string", "null"], description: "Optional. " + OWNER_RULE },
				title: { type: "string", description: "Defaults to the file's own name without its extension." },
				project_id: { type: ["string", "null"], description: "Optional. Must belong to the client when both are given." },
				issued_on: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
			},
			required: ["source_path"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const input: ImportDocumentInput = {
				sourcePath: String(args.source_path),
				clientId: (args.client_id as string | null) ?? null,
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.project_id !== undefined ? { projectId: args.project_id as string | null } : {}),
				...(args.issued_on !== undefined ? { issuedOn: String(args.issued_on) } : {}),
			};
			return imports.importPath(input);
		},
	},
	{
		name: "documents.list_versions",
		title: "List a document's versions",
		description:
			"Every file a document has been, newest first: generated, imported, stamped, signed digitally. " +
			"The newest is the one the document opens as. Numbered from the oldest.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { document_id: { type: "string", description: "Document id." } },
			required: ["document_id"],
			additionalProperties: false,
		},
		handler: async (args) => versions.list(String(args.document_id)),
	},
	{
		name: "documents.find_matches",
		title: "Find documents a file matches",
		description:
			"Reads a file on this machine and lists the existing documents it looks like, each with its reason: " +
			"bytes (the same file), text (the same words with a signature or stamp added; PDF, Word, spreadsheet " +
			"and text files only), or name (the same title for the given client). Writes nothing. " +
			"Use it before documents.import to decide whether the file is a new version instead.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				source_path: { type: "string", description: "Absolute path to the file on this machine." },
				client_id: { type: ["string", "null"], description: "The client the file is for, when known." },
			},
			required: ["source_path"],
			additionalProperties: false,
		},
		handler: async (args) =>
			imports.analysePath({
				sourcePath: String(args.source_path),
				clientId: (args.client_id as string | null) ?? null,
			}),
	},
	{
		name: "documents.add_version",
		title: "Add a file as a version of a document",
		description:
			"Copies a file on this machine into Juno as a new version of an existing document, such as the copy a " +
			"client signed and sent back. Its place among the versions follows the file's own modified date. " +
			"Refused when the same file is already one of the document's versions.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				document_id: { type: "string", description: "The document the file is a version of." },
				source_path: { type: "string", description: "Absolute path to the file on this machine." },
			},
			required: ["document_id", "source_path"],
			additionalProperties: false,
		},
		handler: async (args) =>
			imports.addVersionFromPath({
				documentId: String(args.document_id),
				sourcePath: String(args.source_path),
			}),
	},
	{
		name: "documents.render_pdf",
		title: "Write a document's PDF",
		description: "Renders the stored body to a PDF file and records it as the document's newest version.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => actions.renderPdf(String(args.id)),
	},
	{
		name: "documents.set_status",
		title: "Set a document's status",
		description: "Points a document at an item in the document_status reference set.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, status_id: { type: ["string", "null"] } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			documents.setStatus(String(args.id), (args.status_id as string | null) ?? null),
	},
	{
		name: "documents.signatures",
		title: "List a document's signatures",
		description:
			"Who signed, when, and the hash of the bytes they signed. Signing itself is not exposed.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { document_id: { type: "string" } },
			required: ["document_id"],
			additionalProperties: false,
		},
		handler: async (args) => actions.signatures(String(args.document_id)),
	},
	{
		name: "documents.timeline",
		title: "Show what happened to a document",
		description:
			"Newest first: each version that was made (generated, imported, stamped, signed) and each email " +
			"that carried the document. Times are UTC ISO-8601.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { document_id: { type: "string" } },
			required: ["document_id"],
			additionalProperties: false,
		},
		handler: async (args) => timeline.timeline(String(args.document_id)),
	},
	{
		name: "documents.remove_version",
		title: "Delete one version of a document",
		description:
			"Soft deletes one version. The person is asked in a native dialog and nothing happens until they " +
			"agree; returns deleted false when they decline. Refused for the only version of a document.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { version_id: { type: "string", description: "Version id, from documents.list_versions." } },
			required: ["version_id"],
			additionalProperties: false,
		},
		handler: async (args) => ({ deleted: await actions.deleteVersion(String(args.version_id)) }),
	},
	{
		name: "documents.remove",
		title: "Delete a document",
		description: "Soft delete. The record can be restored.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => documents.remove(String(args.id)),
	},
];
