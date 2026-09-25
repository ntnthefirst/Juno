import type { MailAddress, MailDraftInput, MailOutboxState } from "../../shared/types";
import * as outbox from "../services/mail-outbox";
import * as templates from "../services/mail-templates";
import type { ToolDescriptor } from "./types";

/**
 * Sending tools.
 *
 * `mail.send` does not send. It moves a draft to `pending`, where a person sees
 * the whole message in the app and approves or rejects it. There is no
 * `mail.outbox.approve` tool and there will not be one: the service only queues
 * a message for a caller that says it is a person, and this file never says
 * that (.claude/rules/mcp.md section 4).
 *
 * Read receipts and tracking are permanently out of scope, so there is nothing
 * here that could ask for one.
 */

const OUTBOX_STATES: MailOutboxState[] = [
	"draft",
	"pending",
	"queued",
	"sending",
	"sent",
	"failed",
	"cancelled",
];

const ADDRESS_LIST = {
	type: "array",
	items: {
		type: "object",
		properties: {
			name: { type: ["string", "null"] },
			address: { type: "string" },
		},
		required: ["address"],
		additionalProperties: false,
	},
};

function addresses(value: unknown): MailAddress[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(v): v is { name?: string | null; address: string } =>
				typeof v === "object" && v !== null && typeof (v as { address?: unknown }).address === "string",
		)
		.map((v) => ({ name: v.name ?? null, address: v.address }));
}

/**
 * The canvas, as an argument.
 *
 * Declared loosely on purpose: the shape is large, it is versioned in
 * shared/types.ts, and `normaliseLayout` in services/mail-layout.ts is what
 * actually decides what a valid layout is. A second copy of those rules
 * written out as JSON Schema would be a second thing to keep in step, and the
 * one that drifted would be this one.
 */
const LAYOUT_SCHEMA = {
	type: ["object", "null"],
	description:
		"The section and block canvas. { version: 1, width, minHeight, background, customCss, " +
		"sections: [{ id, name, layout, box, blocks }] }. A section lays its blocks out with flex " +
		"or grid; nothing is positioned absolutely and custom CSS that tries to is dropped. Call " +
		"mail.templates.get on an existing template to see the shape, and mail.templates.preview " +
		"to check one before proposing it. Null drops the canvas and keeps the HTML it compiled to.",
};

export const mailOutboxTools: ToolDescriptor[] = [
	{
		name: "mail.templates.list",
		title: "List mail templates",
		description: "The Dutch mail templates with their placeholders and register (u or je).",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => templates.list(),
	},
	{
		name: "mail.templates.render",
		title: "Fill a mail template",
		description:
			"Fills a template against a client and project and returns the subject, the HTML body " +
			"in the house style and its text twin, plus the placeholders that had no value. Stores " +
			"nothing; put the result in mail.draft.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string" },
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
				extras: {
					type: "object",
					description:
						"Values no record holds, by placeholder name under document: title, dueOn (YYYY-MM-DD), amount.",
					additionalProperties: { type: "string" },
				},
			},
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.renderTemplate({
				templateId: String(args.template_id),
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
				...(args.extras && typeof args.extras === "object"
					? { extras: args.extras as Record<string, string> }
					: {}),
			}),
	},
	{
		name: "mail.templates.get",
		title: "Read one mail template",
		description:
			"One template with its subject, its compiled body, the values it asks for and, when it " +
			"has one, the canvas it is laid out on. Read this before proposing an edit, because " +
			"mail.templates.update replaces what it is given.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { template_id: { type: "string" } },
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) => templates.get(String(args.template_id)),
	},
	{
		name: "mail.templates.preview",
		title: "Preview a mail template that is not saved",
		description:
			"Compiles a subject and a body or a canvas and renders them the way a message would go " +
			"out, without touching anything stored. This is how to check an edit before proposing " +
			"it: try a layout here, read the HTML and the missing placeholders back, and only then " +
			"call mail.templates.update.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				subject: { type: "string" },
				body_html: { type: "string", description: "Ignored when a layout is given." },
				layout: LAYOUT_SCHEMA,
				inputs: { type: "array", description: "The declared inputs, so a field block knows its kind." },
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
			},
			required: ["subject"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.previewDraft({
				subject: String(args.subject),
				...(typeof args.body_html === "string" ? { bodyHtml: args.body_html } : {}),
				...(args.layout !== undefined ? { layout: args.layout as never } : {}),
				...(Array.isArray(args.inputs) ? { inputs: args.inputs as never } : {}),
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
			}),
	},
	{
		name: "mail.templates.create",
		title: "Create a mail template",
		description:
			"A new template of the owner's own, never a system one. The body is Dutch, because a " +
			"client reads it. Pass a layout to lay it out on the canvas, or body_html to write the " +
			"HTML by hand.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				subject: { type: "string" },
				body_html: { type: "string", description: "Ignored when a layout is given." },
				description: { type: ["string", "null"] },
				register: { type: "string", enum: ["u", "je"], description: "Held for the whole template." },
				inputs: { type: "array" },
				layout: LAYOUT_SCHEMA,
			},
			required: ["name", "subject"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.create({
				name: String(args.name),
				subject: String(args.subject),
				bodyHtml: typeof args.body_html === "string" ? args.body_html : "<p></p>",
				description: (args.description as string | null) ?? null,
				...(args.register === "je" || args.register === "u" ? { register: args.register } : {}),
				...(Array.isArray(args.inputs) ? { inputs: args.inputs as never } : {}),
				...(args.layout !== undefined ? { layout: args.layout as never } : {}),
			}),
	},
	{
		name: "mail.templates.update",
		title: "Edit a mail template",
		description:
			"Changes a template in place. Only the fields given are touched, and a layout replaces " +
			"the whole canvas rather than merging into it, so read the template first and send the " +
			"canvas back with the change made. The edit is applied to the template as it stands " +
			"when a person approves it, so a template somebody is editing in the window at the " +
			"same time keeps their work and takes this on top.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string" },
				name: { type: "string" },
				subject: { type: "string" },
				body_html: { type: "string", description: "Ignored when the template has a canvas." },
				description: { type: ["string", "null"] },
				register: { type: "string", enum: ["u", "je"] },
				inputs: { type: "array" },
				layout: LAYOUT_SCHEMA,
			},
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.update(String(args.template_id), {
				...(typeof args.name === "string" ? { name: args.name } : {}),
				...(typeof args.subject === "string" ? { subject: args.subject } : {}),
				...(typeof args.body_html === "string" ? { bodyHtml: args.body_html } : {}),
				...(args.description !== undefined ? { description: args.description as string | null } : {}),
				...(args.register === "je" || args.register === "u" ? { register: args.register } : {}),
				...(Array.isArray(args.inputs) ? { inputs: args.inputs as never } : {}),
				...(args.layout !== undefined ? { layout: args.layout as never } : {}),
			}),
	},
	{
		name: "mail.templates.hide",
		title: "Hide a mail template",
		description:
			"Takes a template out of the pickers. Everything already pointing at it still resolves " +
			"and still renders, so this is how a shipped template is retired. There is no tool that " +
			"deletes one.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { template_id: { type: "string" } },
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) => templates.hide(String(args.template_id)),
	},
	{
		name: "mail.outbox.list",
		title: "List the outbox",
		description:
			"Every composed message with its state: draft, pending (waiting for a person), queued, " +
			"sending, sent, failed or cancelled, newest change first.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string" },
				states: { type: "array", items: { type: "string", enum: OUTBOX_STATES } },
				limit: { type: "integer", minimum: 1, maximum: 500 },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			outbox.list({
				...(args.account_id !== undefined ? { accountId: String(args.account_id) } : {}),
				...(Array.isArray(args.states) ? { states: args.states as MailOutboxState[] } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
			}),
	},
	{
		name: "mail.outbox.get",
		title: "Read an outbox message",
		description: "One composed message in full, including its state and any error.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => outbox.get(String(args.id)),
	},
	{
		name: "mail.draft",
		title: "Write a draft",
		description:
			"Creates a draft in the outbox. Nothing is sent. Plain text is turned into HTML in the " +
			"house style; pass body_html from mail.templates.render to keep a template's layout. " +
			"reply_to_message_id threads it under a received message. document_ids attach PDFs.",
		readOnly: false,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string" },
				to: ADDRESS_LIST,
				cc: ADDRESS_LIST,
				bcc: ADDRESS_LIST,
				subject: { type: "string" },
				body_text: { type: "string" },
				body_html: { type: ["string", "null"] },
				reply_to_message_id: { type: ["string", "null"], description: "A mail.messages id." },
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
				template_id: { type: ["string", "null"] },
				document_ids: { type: "array", items: { type: "string" } },
			},
			required: ["account_id", "to", "subject", "body_text"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const input: MailDraftInput = {
				accountId: String(args.account_id),
				to: addresses(args.to),
				cc: addresses(args.cc),
				bcc: addresses(args.bcc),
				subject: String(args.subject),
				bodyText: String(args.body_text),
				bodyHtml: (args.body_html as string | null) ?? null,
				replyToMessageId: (args.reply_to_message_id as string | null) ?? null,
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
				templateId: (args.template_id as string | null) ?? null,
				documentIds: Array.isArray(args.document_ids) ? args.document_ids.map(String) : [],
			};
			return outbox.createDraft(input);
		},
	},
	{
		name: "mail.send",
		title: "Ask to send a draft",
		description:
			"Asks for a draft to be sent. It does not send: the message becomes pending and a person " +
			"approves or rejects it in the app, seeing the full message. Returns the message in its " +
			"pending state. A rejected or edited message is not retried.",
		readOnly: false,
		requiresConfirmation: true,
		// The outbox is the gate for this one, and it shows the real message
		// rather than an argument list (decision 22). Parking it in the generic
		// gate as well would ask a person twice about one send.
		gatedInService: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => outbox.requestSend(String(args.id), { actor: "agent" }),
	},
	{
		name: "mail.outbox.cancel",
		title: "Cancel an outbox message",
		description:
			"Withdraws a draft, a pending, a queued or a failed message. A sent one cannot be unsent.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => outbox.cancel(String(args.id)),
	},
	{
		name: "mail.outbox.retry",
		title: "Retry a failed message",
		description:
			"Puts a failed message back in the queue under the same Message-ID. It was approved " +
			"once already, so no second approval is asked.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => outbox.retry(String(args.id)),
	},
];
