/**
 * The agent surface for reference data. Declares tools and calls the service.
 * Nothing decides anything here (.claude/rules/mcp.md).
 *
 * Every write is marked as needing confirmation. Reference data is small and
 * looks harmless, but hiding a status changes what every picker in the app
 * offers, and a reset can drop labels somebody made themselves.
 */
import type { ReferenceItemPatch, ReferenceSetKey, ResetUserItems } from "../../shared/types";
import * as reference from "../services/reference";
import type { ToolDescriptor } from "./types";

const SET_KEYS = ["client_status", "project_status", "document_status", "label"];

const setKeyProperty = {
	type: "string",
	enum: SET_KEYS,
	description: "Which list to act on, for example client_status.",
};

const itemIdProperty = {
	type: "string",
	description: "The id of the reference item, as returned by reference.list_sets.",
};

const userItemsProperty = {
	type: "string",
	enum: ["keep", "remove"],
	description:
		"What to do with items the user created themselves: keep them, or remove the ones nothing points at.",
};

export const referenceTools: ToolDescriptor[] = [
	{
		name: "reference.list_sets",
		title: "List reference sets",
		description:
			"Every editable list in Bureau (client statuses, project statuses, document statuses, labels) with its items. Hidden items are included and carry a hiddenAt timestamp; do not offer those when setting a value on a record.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: () => reference.listSets(),
	},
	{
		name: "reference.get_set",
		title: "Get one reference set",
		description: "One list and its items, by set key. Returns null when the set does not exist.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { key: setKeyProperty },
			required: ["key"],
			additionalProperties: false,
		},
		handler: (args) => reference.getSet(args.key as ReferenceSetKey),
	},
	{
		name: "reference.usage",
		title: "Count records using an item",
		description:
			"How many live clients and projects point at this reference item. Check this before hiding one, because the count is what the warning is about.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { item_id: itemIdProperty },
			required: ["item_id"],
			additionalProperties: false,
		},
		handler: (args) => reference.usage(args.item_id as string),
	},
	{
		name: "reference.create_item",
		title: "Add a reference item",
		description:
			"Adds a value to a list. The key is derived from the label when none is given, and must be unique within the set.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				set_id: { type: "string", description: "The id of the set, from reference.list_sets." },
				label: { type: "string", description: "What a person reads, in English." },
				key: {
					type: "string",
					description: "Stable machine key, lowercase with underscores. Derived from the label when omitted.",
				},
				tone: {
					type: ["string", "null"],
					enum: ["ok", "warn", "risk", "seal", "accent", null],
					description: "A colour token name, never a hex value. Null for no colour.",
				},
				sort_order: { type: "number", description: "Position in the list. Appended when omitted." },
			},
			required: ["set_id", "label"],
			additionalProperties: false,
		},
		handler: (args) =>
			reference.createItem({
				setId: args.set_id as string,
				label: args.label as string,
				key: args.key as string | undefined,
				tone: args.tone as string | null | undefined,
				sortOrder: args.sort_order as number | undefined,
			}),
	},
	{
		name: "reference.update_item",
		title: "Edit a reference item",
		description:
			"Changes the label, tone or position of an item. Editing a shipped item marks it as customised, after which an upgrade will leave it alone.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				item_id: itemIdProperty,
				label: { type: "string", description: "What a person reads, in English." },
				tone: {
					type: ["string", "null"],
					enum: ["ok", "warn", "risk", "seal", "accent", null],
					description: "A colour token name, never a hex value. Null for no colour.",
				},
				sort_order: { type: "number", description: "Position in the list." },
			},
			required: ["item_id"],
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: ReferenceItemPatch = {};
			if (args.label !== undefined) patch.label = args.label as string;
			if (args.tone !== undefined) patch.tone = args.tone as string | null;
			if (args.sort_order !== undefined) patch.sortOrder = args.sort_order as number;
			return reference.updateItem(args.item_id as string, patch);
		},
	},
	{
		name: "reference.hide_item",
		title: "Hide a reference item",
		description:
			"Removes an item from the pickers without deleting it. Records that already use it keep showing it. This is the only way to remove a value, by design.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { item_id: itemIdProperty },
			required: ["item_id"],
			additionalProperties: false,
		},
		handler: (args) => reference.hideItem(args.item_id as string),
	},
	{
		name: "reference.unhide_item",
		title: "Show a hidden reference item again",
		description: "Puts a hidden item back in the pickers.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { item_id: itemIdProperty },
			required: ["item_id"],
			additionalProperties: false,
		},
		handler: (args) => reference.unhideItem(args.item_id as string),
	},
	{
		name: "reference.reorder",
		title: "Reorder a reference set",
		description:
			"Sets the order of a list. Pass every item id in the set, in the order they should appear.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				set_id: { type: "string", description: "The id of the set, from reference.list_sets." },
				ordered_ids: {
					type: "array",
					items: { type: "string" },
					description: "Item ids, first to last.",
				},
			},
			required: ["set_id", "ordered_ids"],
			additionalProperties: false,
		},
		handler: (args) => reference.reorder(args.set_id as string, args.ordered_ids as string[]),
	},
	{
		name: "reference.reset_set",
		title: "Reset one reference set",
		description:
			"Puts the shipped items of one list back to their original labels, colours and order, and shows any that were hidden. Items the user made themselves are kept or removed depending on user_items.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { key: setKeyProperty, user_items: userItemsProperty },
			required: ["key", "user_items"],
			additionalProperties: false,
		},
		handler: (args) =>
			reference.resetSet(args.key as ReferenceSetKey, args.user_items as ResetUserItems),
	},
	{
		name: "reference.reset_all",
		title: "Reset every reference set",
		description:
			"The same as reference.reset_set, for every list at once. Ask before running it: it undoes every edit the user made to the shipped values.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { user_items: userItemsProperty },
			required: ["user_items"],
			additionalProperties: false,
		},
		handler: (args) => reference.resetAll(args.user_items as ResetUserItems),
	},
];

export default referenceTools;
