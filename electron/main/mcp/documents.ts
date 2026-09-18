import type { GenerateDocumentInput } from "../../shared/types";
import * as actions from "../services/document-actions";
import * as templates from "../services/document-templates";
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
 * - **Nothing signs.** `documents.sign` exists in the interface only. The
 *   service refuses a specimen regardless, but signing is a person's act.
 */

const templateProperties: Record<string, unknown> = {
	name: { type: "string", description: "Display name, for example Ontwikkelovereenkomst." },
	description: { type: ["string", "null"], description: "One line on what the template is for." },
	body_html: {
		type: "string",
		description:
			"The body as HTML with placeholders, for example {{ client.name }} and " +
			"{{#if client.vatNumber}}...{{/if}}. Values are escaped; a missing one renders a visible marker.",
	},
};

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
			required: ["name", "body_html"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.create({
				name: String(args.name),
				bodyHtml: String(args.body_html),
				description: args.description === undefined ? null : (args.description as string | null),
			}),
	},
	{
		name: "templates.update",
		title: "Edit a document template",
		description:
			"Changes a template. Editing the body clears the review flag and bumps the version, " +
			"because a review applies to text that has not changed since.",
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
];

export const documentTools: ToolDescriptor[] = [
	{
		name: "documents.list",
		title: "List documents",
		description: "Generated documents, newest first, optionally for one client.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { client_id: { type: "string", description: "Limit to one client." } },
			additionalProperties: false,
		},
		handler: async (args) =>
			documents.list(args.client_id ? { clientId: String(args.client_id) } : {}),
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
			"Renders a template against a client and stores the result as a draft. Nothing is sent. " +
			"Placeholders that cannot be filled are rendered as visible markers and reported.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				client_id: { type: "string" },
				template_id: { type: "string" },
				project_id: { type: ["string", "null"], description: "Must belong to the same client." },
				title: { type: "string", description: "Defaults to the template name and client name." },
				issued_on: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
				extras: {
					type: "object",
					description: "Values for document.* placeholders, such as change_summary.",
					additionalProperties: { type: "string" },
				},
			},
			required: ["client_id", "template_id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const input: GenerateDocumentInput = {
				clientId: String(args.client_id),
				templateId: String(args.template_id),
				projectId: (args.project_id as string | null) ?? null,
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.issued_on !== undefined ? { issuedOn: String(args.issued_on) } : {}),
				...(args.extras !== undefined
					? { extras: args.extras as Record<string, string> }
					: {}),
			};
			return documents.generate(input);
		},
	},
	{
		name: "documents.render_pdf",
		title: "Write a document's PDF",
		description: "Renders the stored body to a PDF file and records its path.",
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
