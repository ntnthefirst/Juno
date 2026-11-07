import * as blocks from "../services/mail-blocks";
import type { ComposeBlockKind, ComposeBlockRule } from "../../shared/types";
import type { ToolDescriptor } from "./types";

/**
 * Intros and outros. They change what a person is offered in the composer and
 * nothing else: no tool here sends, and a block never adds itself to a message
 * that already exists. The writes are local, and still wait for approval while
 * every side-effectful call does (decision 24).
 */

const KIND = {
	type: "string",
	enum: ["intro", "outro"],
	description: "intro goes at the start of a message, outro at the end.",
};

const RULE = {
	type: "string",
	enum: ["manual", "client", "new_contact", "reply", "project"],
	description:
		"When it is added on its own: manual never, client when writing to a client, new_contact " +
		"when writing to someone who is not a client, reply when answering a mail, project when " +
		"the mail is linked to a project. When two blocks of one kind match, the higher one wins.",
};

const BODY = {
	type: "string",
	description:
		"The text a client reads, in Dutch (Belgium). Line breaks are kept. Variables are written " +
		"{{client_name}}, {{first_name}}, {{project}}, {{date}} and {{my_name}}. A block that uses " +
		"a variable with no value for a message is not added to it automatically.",
};

export const mailBlockTools: ToolDescriptor[] = [
	{
		name: "mail.blocks.list",
		title: "List intros and outros",
		description:
			"Every intro and outro, intros first, each in the order that decides which one wins when " +
			"two match. Each has an id, a name, its text with {{variable}} tokens and its rule.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { kind: { ...KIND, description: "Only this kind. Both when left out." } },
			additionalProperties: false,
		},
		handler: async (args) => blocks.list(args.kind as ComposeBlockKind | undefined),
	},
	{
		name: "mail.blocks.create",
		title: "Create an intro or outro",
		description:
			"Adds a block to the end of its list. It only changes what the composer offers or " +
			"inserts for new messages. Reversible with mail.blocks.delete.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				kind: KIND,
				name: { type: "string", description: "What the person calls it, like Formal." },
				body: BODY,
				rule: RULE,
			},
			required: ["kind", "name", "body"],
			additionalProperties: false,
		},
		handler: async (args) =>
			blocks.create({
				kind: args.kind as ComposeBlockKind,
				name: String(args.name),
				body: String(args.body),
				...(args.rule !== undefined ? { rule: args.rule as ComposeBlockRule } : {}),
			}),
	},
	{
		name: "mail.blocks.update",
		title: "Change an intro or outro",
		description: "Changes the name, the text or the rule of one block. Fields left out stay as they are.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "The block id from mail.blocks.list." },
				name: { type: "string" },
				body: BODY,
				rule: RULE,
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			blocks.update(String(args.id), {
				...(args.name !== undefined ? { name: String(args.name) } : {}),
				...(args.body !== undefined ? { body: String(args.body) } : {}),
				...(args.rule !== undefined ? { rule: args.rule as ComposeBlockRule } : {}),
			}),
	},
	{
		name: "mail.blocks.delete",
		title: "Delete an intro or outro",
		description:
			"Removes a block from the list. Messages that already contain its text keep it, because " +
			"the text was copied into them.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "The block id from mail.blocks.list." } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => blocks.remove(String(args.id)),
	},
	{
		name: "mail.blocks.reorder",
		title: "Reorder intros or outros",
		description:
			"Sets the order of one kind. Pass every id of that kind exactly once, first is highest. " +
			"The first block whose rule matches a message is the one it gets.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				kind: KIND,
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Every block id of that kind, in the new order.",
				},
			},
			required: ["kind", "ids"],
			additionalProperties: false,
		},
		handler: async (args) => blocks.reorder(args.kind as ComposeBlockKind, (args.ids as unknown[]).map(String)),
	},
];
