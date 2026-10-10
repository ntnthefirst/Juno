import type { MailAddress, MailDraftInput, MailOutboxState, MailTemplateSendInput } from "../../shared/types";
import * as outbox from "../services/mail-outbox";
import * as templates from "../services/mail-templates";
import type { ToolDescriptor } from "./types";

/**
 * Writing and sending tools.
 *
 * An agent can send mail in exactly two ways: a draft it wrote (`mail.send`) or
 * a template (`mail.send_from_template`). A template is never a draft, so it is
 * filled and sent in one step. Neither runs when it is called. The request is
 * parked under Agent with the whole message as a preview, nothing shows up in
 * the mail screen, and a person approves or rejects it there
 * (.claude/rules/mcp.md section 4). There is no tool that approves.
 *
 * The drafts an agent writes open in the editor like ones a person started.
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

function templateInput(args: Record<string, unknown>): MailTemplateSendInput {
	return {
		accountId: String(args.account_id),
		templateId: String(args.template_id),
		to: addresses(args.to),
		cc: addresses(args.cc),
		bcc: addresses(args.bcc),
		clientId: (args.client_id as string | null) ?? null,
		projectId: (args.project_id as string | null) ?? null,
		...(args.extras && typeof args.extras === "object" ? { extras: args.extras as Record<string, string> } : {}),
		documentIds: Array.isArray(args.document_ids) ? args.document_ids.map(String) : [],
	};
}

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
		"The canvas, a tree. { version: 2, width, widthMode: fill or fixed, minHeight, fill, " +
		"fonts, customCss, children, breakpoints }. The message is sent with nothing around it: " +
		"with widthMode fill it is as wide as the reader's mail client, with fixed it is at most " +
		"width and centred. children is a list of nodes, each a container, a columns table or a " +
		"block, and a container's own children are the same. A container is { kind: container, " +
		"id, tag: section, div, header, footer, main, article, aside or nav, hidden, name, " +
		"alignSelf, grow, layout, box, children }; it lays its children out with flex or grid, " +
		"nothing is positioned absolutely, and custom CSS that tries to is dropped. A columns " +
		"table is the one layout that stays side by side in Outlook on Windows: { kind: columns, " +
		"id, hidden, name, alignSelf, grow, gap, box, rows: [{ id, cells: [{ id, width (percent " +
		"or null), verticalAlign, box, children }] }] }. A block has a kind (text, heading, " +
		"button, image, divider, spacer, field or html) and, for text, a tag (p, blockquote, " +
		"pre, address, span, ul or ol, where ul and ol write their html as <li> items), and for " +
		"heading, a tag (h1 to h6). Every container, columns table, cell and block carries " +
		"actions, empty by default: at most one on click, { id, trigger: click, kind: link, mail or " +
		"call, target, hidden }, where target is the address after https://, the email address or " +
		"the phone number and the message is sent with a link to it, and any number on hover, at " +
		"most one for each change, { id, trigger: hover, change: fill, color, underline or opacity, " +
		"hidden } plus the value the change needs (fill, a colour, underline as true or false, or " +
		"opacity from 0 to 1). An element that sits in a link, or " +
		"holds one, cannot have a click of its own, a link cannot hold a link, so the inner one is " +
		"dropped; a button block has its own href instead of a click. A picture links through a click " +
		"action, not an href. Hover is sent as a :hover rule in the head, which Apple Mail, iOS Mail " +
		"and Outlook on the web apply and Gmail and Outlook on Windows do not, and it is the same at " +
		"every width. There is no script and no other trigger: every mail client removes them. A box carries fill (solid or a two-stop gradient, each with hidden), " +
		"stroke (borderWidth, borderColor, borderStyle, borderSides, strokeHidden), radius or " +
		"four corners, opacity, effects (shadow or blur, each with hidden), padding and margin " +
		"(pixels on each side; a margin on a side the element's alignment already sets to auto is " +
		"ignored, and a cell takes none), width, minHeight and clip. " +
		"A container's layout is { kind: flex, direction, justify, align, gap, wrap } or { kind: " +
		"grid, columns, gap, align, justify }, where a grid's justify is across its cells and " +
		"stretch is the default. An empty container with a minHeight and a fill or a one-sided stroke is a divider. " +
		"A text style carries fontFamily, weight (thin to black), italic, decoration, transform, " +
		"letterSpacing and both alignments. fonts: [{ family, source: google or link, href for a " +
		"link, weights, italic, fallback: sans, serif or mono }]; a block names a font by its " +
		"family. A code block is { kind: html, html, css }. breakpoints: [{ id, name, maxWidth, " +
		"sections: { [id]: { hidden, alignSelf, grow, layout, box } }, blocks: { [id]: { hidden, " +
		"grow, alignSelf, box, text, ... } } }], keyed by the id of any container, columns table, " +
		"cell or block, each holding only what changes at that width and narrower, as partial box " +
		"and text styles (a cell can change only its box, and its width, vertical alignment and " +
		"the table's gap are the same at every width); content is the same at every width. Colours are hex, #rrggbbaa for an " +
		"opacity; images and links https only (a link may also be mailto or tel). Version 1, one level of sections holding blocks, " +
		"is still accepted and read as each section becoming a section container. Call " +
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
			"Fills a template with values for its declared inputs and returns the subject, the HTML " +
			"body and its text twin, plus the placeholders that had no value. Stores nothing: a check " +
			"before mail.send_from_template.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string" },
				extras: {
					type: "object",
					description:
						"A value for each of the template's declared inputs, by input key (see inputs on " +
						"mail.templates.get). Nothing is filled in from a client, a project or the owner's " +
						"details. A date is YYYY-MM-DD; a picture is a data:image address or an https address.",
					additionalProperties: { type: "string" },
				},
			},
			required: ["template_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			templates.renderTemplate({
				templateId: String(args.template_id),
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
				extras: {
					type: "object",
					description: "A value for each declared input, by input key, to preview it filled in.",
					additionalProperties: { type: "string" },
				},
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
				...(args.extras && typeof args.extras === "object"
					? { extras: args.extras as Record<string, string> }
					: {}),
			}),
	},
	{
		name: "mail.templates.create",
		title: "Create a mail template",
		description:
			"A new template of the owner's own, never a system one. The body is Dutch, because a " +
			"client reads it. Pass a layout to lay it out on the canvas, or body_html to write the " +
			"HTML by hand. It fills in only its own inputs: declare each value it prints in inputs " +
			"and write it as {{document.<key>}}. A placeholder naming a client, a project or the " +
			"owner is refused.",
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
			"Writes a plain draft and opens it in the editor for a person. Nothing is sent. The text is " +
			"turned into HTML in the house style. Use it for a new mail. To answer a received message " +
			"use mail.reply, which works out the recipients, subject and quote itself; " +
			"reply_to_message_id here only threads a draft whose addresses you chose. To send the " +
			"draft ask with mail.send. A template is never a draft: use mail.send_from_template. " +
			"document_ids attach PDFs.",
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
				reply_to_message_id: { type: ["string", "null"], description: "A mail.messages id." },
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
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
				replyToMessageId: (args.reply_to_message_id as string | null) ?? null,
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
				documentIds: Array.isArray(args.document_ids) ? args.document_ids.map(String) : [],
				actor: "agent",
			};
			return outbox.createDraft(input);
		},
	},
	{
		name: "mail.reply",
		title: "Reply to a message",
		description:
			"Writes a reply to a received message the way the Reply button does, from the new text " +
			"alone. Juno works out the recipients (the sender, or Reply-To), the Re: subject, the " +
			"threading headers and the client, and puts the original quoted under your text. Read " +
			"the thread first with mail.threads.get and mail.messages.body, then pass the id of the " +
			"message you are answering. body_text is plain text, never HTML, and only your part: do " +
			"not repeat the quote. mode reply_all keeps everyone on the original, and forward needs " +
			"a to. It writes a draft and opens it in the editor for a person. Nothing is sent: to send " +
			"it ask with mail.send.",
		readOnly: false,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				message_id: { type: "string", description: "A mail.messages id, the message being answered." },
				body_text: { type: "string", description: "The new text, plain, without the quoted original." },
				mode: { type: "string", enum: ["reply", "reply_all", "forward"], description: "Default reply." },
				to: { ...ADDRESS_LIST, description: "Only to replace the worked-out recipients. Required for a forward." },
				cc: { ...ADDRESS_LIST, description: "Only to replace the worked-out Cc." },
				bcc: ADDRESS_LIST,
				include_quote: { type: "boolean", description: "Default true." },
				document_ids: { type: "array", items: { type: "string" } },
			},
			required: ["message_id", "body_text"],
			additionalProperties: false,
		},
		handler: async (args) =>
			outbox.createReply({
				messageId: String(args.message_id),
				bodyText: String(args.body_text),
				...(args.mode === "reply" || args.mode === "reply_all" || args.mode === "forward"
					? { mode: args.mode }
					: {}),
				...(args.to !== undefined ? { to: addresses(args.to) } : {}),
				...(args.cc !== undefined ? { cc: addresses(args.cc) } : {}),
				...(args.bcc !== undefined ? { bcc: addresses(args.bcc) } : {}),
				...(args.include_quote !== undefined ? { includeQuote: Boolean(args.include_quote) } : {}),
				documentIds: Array.isArray(args.document_ids) ? args.document_ids.map(String) : [],
				actor: "agent",
			}),
	},
	{
		name: "mail.send_from_template",
		title: "Ask to send a mail from a template",
		description:
			"Fills a mail template with values for its inputs and asks to send it as a new message, in " +
			"one step. The client and project file the message and fill in nothing. It does not send: the request waits under Agent in Juno, where a person reads " +
			"the whole filled message and approves or rejects it, and nothing appears in the mail " +
			"screen. A template is never saved as a draft and cannot be used for a reply or a " +
			"forward; for those write a draft with mail.reply and ask with mail.send. A request that " +
			"could not be sent, such as a placeholder without a value or a recipient missing, is " +
			"refused at once. Check the result with mail.templates.render first when values may be " +
			"missing. Returns pending.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string" },
				template_id: { type: "string" },
				to: ADDRESS_LIST,
				cc: ADDRESS_LIST,
				bcc: ADDRESS_LIST,
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
				extras: {
					type: "object",
					description:
						"A value for each of the template's declared inputs, by input key (see inputs on " +
						"mail.templates.get). Nothing is filled in from a client, a project or the owner's " +
						"details. A date is YYYY-MM-DD; a picture is a data:image address or an https address.",
					additionalProperties: { type: "string" },
				},
				document_ids: { type: "array", items: { type: "string" } },
			},
			required: ["account_id", "template_id", "to"],
			additionalProperties: false,
		},
		prepare: (args) => outbox.reviewTemplateSend(templateInput(args)),
		verify: (args, seal) => outbox.verifyTemplateUnchanged(templateInput(args), seal),
		handler: async (args) => outbox.sendFromTemplate(templateInput(args)),
	},
	{
		name: "mail.send",
		title: "Ask to send a draft",
		description:
			"Asks for a draft to be sent. It does not send: the request waits under Agent in Juno, " +
			"where a person reads the whole message and approves or rejects it, and nothing appears " +
			"in the mail screen. The draft has to be complete (a recipient, a subject, some text or " +
			"an attachment) or the request is refused at once. If the draft is edited after you ask, " +
			"the approval is refused and you have to ask again. Returns pending. A template is not a " +
			"draft: use mail.send_from_template.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "A draft's id, from mail.draft or mail.outbox.list." } },
			required: ["id"],
			additionalProperties: false,
		},
		prepare: (args) => outbox.reviewForSend(String(args.id)),
		verify: (args, seal) => outbox.verifyDraftUnchanged(String(args.id), seal),
		handler: async (args) => outbox.requestSend(String(args.id)),
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
];
