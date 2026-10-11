import type { GenerateDocumentInput, ImportDocumentInput } from "../../shared/types";
import * as actions from "../services/document-actions";
import * as templates from "../services/document-templates";
import { importDocxFile } from "../services/document-docx";
import * as templateAssets from "../services/document-template-assets";
import * as imports from "../services/document-import";
import * as timeline from "../services/document-timeline";
import * as versions from "../services/document-versions";
import * as documents from "../services/documents";
import type { ToolDescriptor } from "./types";

/**
 * Tools for templates and documents.
 *
 * Two things are deliberately absent, and both for the same reason as
 * `app.unlock`: a tool that can make a claim a person should be making.
 *
 * - **Nothing marks a template as reviewed.** Reviewing is a statement that the
 *   legal text has been read and is sound. An agent cannot know that, and a tool
 *   that could set the flag would let an invented contract be promoted to a real
 *   one without anybody reading it. See docs/templates.md.
 * - **Nothing signs, and nothing touches the certificate.** `documents.sign` and
 *   the signing certificate exist in the interface only. The service refuses a
 *   specimen regardless, but signing is a person's act: placing the stamp and
 *   typing the certificate passphrase are things somebody at the keyboard does.
 */

/**
 * A document canvas, as an argument. Declared loosely for the reason the mail
 * canvas is (mcp/mail-outbox.ts): `normaliseDocumentCanvas` decides what is
 * valid, and a second copy of those rules here would be the one that drifts.
 */
const CANVAS_SCHEMA = {
	type: ["object", "null"],
	description:
		"A template laid out on paper: { version: 1, paper: { size: A3, A4, A5, A6, letter or legal, " +
		"orientation: portrait or landscape }, layout }. layout is the mail template canvas (read " +
		"mail.templates.get or the description of the layout argument of mail.templates.create for the " +
		"node shapes), with one difference: every top-level node is a page, a section container the size " +
		"of the paper whose padding is the page margin. Its width, height, place and clip are set from the " +
		"paper and anything sent for them is replaced; a block sent at the top level goes onto the page " +
		"before it. Pages print one per sheet and clip what runs past the bottom, so split long text over " +
		"pages. There are no breakpoints. A canvas template fills in its own inputs and nothing else: every " +
		"placeholder is {{document.<input key>}} for an input it declares, and a picture it carries is " +
		"{{asset.<key>}} as the src of an image block, from templates.add_image. A placeholder naming a " +
		"client, a project or the owner is refused. Call templates.fill to check one before proposing it. " +
		"Null drops the canvas and keeps the HTML it compiled to.",
};

const INPUTS_SCHEMA = {
	type: "array",
	description:
		"What the template asks for when it is used: [{ key, label, kind: text, textarea, number, money, " +
		"date, choice, image or url, required, help, defaultValue, options for a choice }]. The key is " +
		"lowercase letters, digits and underscores and is written {{document.<key>}} in the canvas. An " +
		"image input is filled with a picture as a data:image/png;base64 or jpeg, gif or webp address, " +
		"never a web address.",
};

const templateProperties: Record<string, unknown> = {
	name: { type: "string", description: "Display name, for example Ontwikkelovereenkomst." },
	description: { type: ["string", "null"], description: "One line on what the template is for." },
	body_html: {
		type: "string",
		description:
			"The body as HTML with placeholders, for example {{ client.name }} and " +
			"{{#if client.vatNumber}}...{{/if}}. Values are escaped; a missing one renders a visible marker. " +
			"Ignored when a canvas is given or the template has one. Left out on create with no canvas, the " +
			"template gets one empty page of A4 on the canvas, ready to be filled in in the editor.",
	},
	canvas: CANVAS_SCHEMA,
	inputs: INPUTS_SCHEMA,
};

const OWNER_RULE =
	"A document belongs to a client, a project, both, or neither. A project that has a client brings " +
	"that client along; naming a different client is refused.";

export const templateTools: ToolDescriptor[] = [
	{
		name: "templates.list",
		title: "List document templates",
		description:
			"Every document template, with its placeholders and whether its text has been reviewed. " +
			"A template with reviewed_at null is a specimen: anything generated from it is marked and cannot be signed.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => templates.list(),
	},
	{
		name: "templates.get",
		title: "Read a document template",
		description: "One template including its full body.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Template id." } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => templates.get(String(args.id)),
	},
	{
		name: "templates.create",
		title: "Create a document template",
		description:
			"Adds a template. It starts unreviewed, and only a person can change that, so documents " +
			"generated from it are marked as specimens until the text has been checked.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: templateProperties,
			required: ["name"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.create({
				name: String(args.name),
				...(args.body_html === undefined ? {} : { bodyHtml: String(args.body_html) }),
				description: args.description === undefined ? null : (args.description as string | null),
				...(args.canvas !== undefined ? { canvas: args.canvas as never } : {}),
				...(Array.isArray(args.inputs) ? { inputs: args.inputs as never } : {}),
			}),
	},
	{
		name: "templates.update",
		title: "Edit a document template",
		description:
			"Changes a template. Editing the body clears the review flag and bumps the version, " +
			"because a review applies to text that has not changed since. A canvas replaces the whole " +
			"canvas rather than merging into it, so read the template with templates.get first and send it " +
			"back with the change made.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, ...templateProperties },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.update(String(args.id), {
				...(args.name !== undefined ? { name: String(args.name) } : {}),
				...(args.description !== undefined
					? { description: args.description as string | null }
					: {}),
				...(args.body_html !== undefined ? { bodyHtml: String(args.body_html) } : {}),
				...(args.canvas !== undefined ? { canvas: args.canvas as never } : {}),
				...(Array.isArray(args.inputs) ? { inputs: args.inputs as never } : {}),
			}),
	},
	{
		name: "templates.preview",
		title: "Preview a template body",
		description:
			"Renders a body against a real client without storing anything, and reports which " +
			"placeholders could not be filled.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				body_html: { type: "string" },
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
			},
			required: ["body_html"],
			additionalProperties: false,
		},
		handler: async (args) =>
			actions.previewTemplate({
				bodyHtml: String(args.body_html),
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
				isSpecimen: true,
			}),
	},
	{
		name: "templates.fill",
		title: "Fill in a canvas template",
		description:
			"Fills a template laid out on paper with values, without storing anything, and returns the HTML " +
			"it prints as and the inputs that had no value. A draft canvas and inputs may be given to check an " +
			"edit before proposing it. A canvas template takes nothing from a client or a project: every value " +
			"is in values.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string" },
				values: {
					type: "object",
					description: "Values by input key. A picture input takes a data:image address.",
					additionalProperties: { type: "string" },
				},
				canvas: CANVAS_SCHEMA,
				inputs: INPUTS_SCHEMA,
			},
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.fillCanvas({
				templateId: String(args.template_id),
				values: (args.values as Record<string, string> | undefined) ?? {},
				...(args.canvas ? { canvas: args.canvas as never } : {}),
				...(Array.isArray(args.inputs) ? { inputs: args.inputs as never } : {}),
			}),
	},
	{
		name: "templates.list_images",
		title: "List a template's pictures",
		description:
			"The pictures a document template carries, each with the token to write as an image block's src " +
			"on its canvas.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { template_id: { type: "string" } },
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) => templateAssets.list(String(args.template_id)),
	},
	{
		name: "templates.add_image",
		title: "Add a picture to a template",
		description:
			"Stores a PNG, JPEG, GIF or WebP picture of at most 10 MB for a document template and returns it " +
			"with its token, {{asset.<key>}}, to use as the src of an image block on the canvas. Adding the " +
			"same picture twice gives back the one already there.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string" },
				file_name: { type: "string", description: "Shown in the editor, for example logo.png." },
				data_base64: { type: "string", description: "The picture's bytes, base64 encoded." },
			},
			required: ["template_id", "file_name", "data_base64"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templateAssets.add({
				templateId: String(args.template_id),
				fileName: String(args.file_name),
				data: new Uint8Array(Buffer.from(String(args.data_base64), "base64")),
			}),
	},
	{
		name: "templates.import_docx",
		title: "Make a template from a Word file",
		description:
			"Reads a .docx on this machine into a new document template on A4: its headings, paragraphs, " +
			"lists, tables and pictures become blocks on the canvas, and every field written {{ name }} in it " +
			"becomes a required input. Everything lands on the first page; opening it in the editor flows it " +
			"onto as many pages as it needs. It starts unreviewed.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				source_path: { type: "string", description: "Absolute path to the .docx on this machine." },
			},
			required: ["source_path"],
			additionalProperties: false,
		},
		handler: async (args) => importDocxFile(String(args.source_path)),
	},
];

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
		handler: async (args) => documents.get(String(args.id)),
	},
	{
		name: "documents.generate",
		title: "Generate a document",
		description:
			"Renders a template and stores the result as a draft with its PDF, under a client, a project, " +
			"both or neither. A project that has a client brings that client along. Nothing is sent. " +
			"Placeholders that cannot be filled are rendered as visible markers and reported. A template laid " +
			"out on paper (one with a canvas) takes every value from extras, keyed by its input keys, and " +
			"nothing from the client: the client is who the document belongs to.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: ["string", "null"], description: "Optional. " + OWNER_RULE },
				template_id: { type: "string" },
				project_id: { type: ["string", "null"], description: "Optional. Must belong to the client when both are given." },
				title: { type: "string", description: "Defaults to the template name and the client or project name." },
				issued_on: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
				extras: {
					type: "object",
					description: "Values for document.* placeholders, such as change_summary.",
					additionalProperties: { type: "string" },
				},
			},
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const input: GenerateDocumentInput = {
				clientId: (args.client_id as string | null) ?? null,
				templateId: String(args.template_id),
				projectId: (args.project_id as string | null) ?? null,
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.issued_on !== undefined ? { issuedOn: String(args.issued_on) } : {}),
				...(args.extras !== undefined
					? { extras: args.extras as Record<string, string> }
					: {}),
			};
			// Generating writes the PDF, the same way it does for the window. An
			// agent that could produce a document without its file would be making
			// a record the interface then has to explain.
			return actions.generate(input);
		},
	},
	{
		name: "documents.import",
		title: "Import a PDF as a document",
		description:
			"Copies an existing PDF on this machine into Juno and records it under a client, a project, both " +
			"or neither. It has no body " +
			"and cannot be rendered again, because it did not come from a template, but it can still be signed. " +
			"Refused when the same client, or project when there is no client, already has a document with the " +
			"same title: check documents.find_matches first.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				source_path: { type: "string", description: "Absolute path to the PDF on this machine." },
				client_id: { type: ["string", "null"], description: "Optional. " + OWNER_RULE },
				title: { type: "string", description: "Defaults to the file's own name." },
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
			return imports.importPdf(input);
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
		title: "Find documents a PDF matches",
		description:
			"Reads a PDF on this machine and lists the existing documents it looks like: the same file, the same " +
			"text with a signature or stamp added, or the same name for the given client. Writes nothing. " +
			"Use it before documents.import to decide whether the file is a new version instead.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				source_path: { type: "string", description: "Absolute path to the PDF on this machine." },
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
		title: "Add a PDF as a version of a document",
		description:
			"Copies a PDF on this machine into Juno as a new version of an existing document, such as the copy a " +
			"client signed and sent back. Its place among the versions follows the file's own modified date. " +
			"Refused when the same file is already one of the document's versions.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				document_id: { type: "string", description: "The document the file is a version of." },
				source_path: { type: "string", description: "Absolute path to the PDF on this machine." },
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
