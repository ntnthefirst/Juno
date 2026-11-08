import type { CalendarColour, CalendarRefreshMinutes, CalendarSubscriptionPatch } from "../../shared/types";
import * as subscriptions from "../services/calendar-subscriptions";
import type { ToolDescriptor } from "./types";

/**
 * Calendar subscriptions: calendars Juno reads from an https address and keeps
 * up to date by itself. Their events are read only, on the calendar and here.
 *
 * Reading the list is free. Everything that makes Juno fetch an address
 * (preview, create, update, refresh) waits for the owner whatever the
 * permission levels say, because a subscription is a standing instruction to
 * go and fetch something, and the owner reads the address before it is
 * fetched. Removing one is in the Delete row. No tool returns an address:
 * a subscription shows its host only.
 */

const COLOUR = {
	type: "string",
	enum: subscriptions.COLOURS,
	description: "Colour on the calendar, as a token name. accent is iris, seal is brass, tone-N-ink are muted tints.",
};

const REFRESH = {
	type: "integer",
	enum: subscriptions.REFRESH_MINUTES,
	description: "How often Juno fetches it again, in minutes: 15, 60 (every hour) or 1440 (every day).",
};

const URL_FIELD = {
	type: "string",
	description:
		"The calendar's address in iCal format, starting with https:// (webcal:// is read as https). " +
		"For Google, the secret address in iCal format from the calendar's settings.",
};

function patchOf(args: Record<string, unknown>): CalendarSubscriptionPatch {
	return {
		...(args.name !== undefined ? { name: String(args.name) } : {}),
		...(args.colour !== undefined ? { colour: args.colour as CalendarColour } : {}),
		...(args.refresh_minutes !== undefined ? { refreshMinutes: Number(args.refresh_minutes) as CalendarRefreshMinutes } : {}),
		...(args.shown !== undefined ? { shown: Boolean(args.shown) } : {}),
		...(args.url !== undefined ? { url: String(args.url) } : {}),
	};
}

function createInput(args: Record<string, unknown>) {
	return {
		url: String(args.url ?? ""),
		name: String(args.name ?? ""),
		...(args.colour !== undefined ? { colour: args.colour as CalendarColour } : {}),
		...(args.refresh_minutes !== undefined ? { refreshMinutes: Number(args.refresh_minutes) as CalendarRefreshMinutes } : {}),
		...(args.mail_account_id !== undefined ? { mailAccountId: String(args.mail_account_id) } : {}),
	};
}

const ID = {
	type: "object",
	properties: { id: { type: "string", description: "A subscription id from calendar.subscriptions.list." } },
	required: ["id"],
	additionalProperties: false,
};

export const calendarSubscriptionTools: ToolDescriptor[] = [
	{
		name: "calendar.subscriptions.list",
		title: "List calendar subscriptions",
		description:
			"Every calendar Juno reads from an address: its name, host, colour, how often it is fetched, when it last " +
			"was, how many events it holds and the last error in plain words. Their events are in calendar.list_events " +
			"with include_subscriptions.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => subscriptions.list(),
	},
	{
		name: "calendar.subscriptions.get",
		title: "Read a calendar subscription",
		description: "One subscription by id, or null when there is none.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: ID,
		handler: async (args) => subscriptions.get(String(args.id)),
	},
	{
		name: "calendar.subscriptions.preview",
		title: "Look at a calendar address",
		description:
			"Fetches an address once and says what calendar it is: its name, how many events and the next one. " +
			"Saves nothing. Waits for the owner to approve, because it makes Juno fetch the address.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { url: URL_FIELD },
			required: ["url"],
			additionalProperties: false,
		},
		prepare: async (args) => subscriptions.reviewPreview(String(args.url ?? "")),
		handler: async (args) => subscriptions.preview(String(args.url)),
	},
	{
		name: "calendar.subscriptions.create",
		title: "Subscribe to a calendar",
		description:
			"Subscribes to a calendar at an https address. Juno fetches it straight away and then on its interval, and " +
			"shows its events read only. Nothing is saved when the first fetch fails. Waits for the owner to approve.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				url: URL_FIELD,
				name: { type: "string", description: "What the calendar is called in Juno, like Belgian public holidays." },
				colour: COLOUR,
				refresh_minutes: REFRESH,
				mail_account_id: {
					type: "string",
					description: "The mail account it belongs with, from mail.accounts.list. Leave out for a calendar of its own.",
				},
			},
			required: ["url", "name"],
			additionalProperties: false,
		},
		prepare: async (args) => subscriptions.reviewCreate(createInput(args)),
		handler: async (args) => subscriptions.create(createInput(args)),
	},
	{
		name: "calendar.subscriptions.update",
		title: "Change a calendar subscription",
		description:
			"Renames it, changes its colour or how often it is fetched, shows or hides it on the calendar, or gives it a " +
			"new address, which is fetched straight away. Waits for the owner to approve.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "A subscription id from calendar.subscriptions.list." },
				name: { type: "string" },
				colour: COLOUR,
				refresh_minutes: REFRESH,
				shown: { type: "boolean", description: "False hides its events from the calendar and keeps fetching it." },
				url: URL_FIELD,
			},
			required: ["id"],
			additionalProperties: false,
		},
		prepare: async (args) => subscriptions.reviewUpdate(String(args.id), patchOf(args)),
		handler: async (args) => subscriptions.update(String(args.id), patchOf(args)),
	},
	{
		name: "calendar.subscriptions.refresh",
		title: "Fetch a calendar subscription again",
		description:
			"Fetches it now instead of at its interval. A failure keeps the events from the last good fetch and is " +
			"returned as lastError on the subscription. Waits for the owner to approve.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: ID,
		prepare: async (args) => subscriptions.reviewRefresh(String(args.id)),
		handler: async (args) => subscriptions.refresh(String(args.id)),
	},
	{
		name: "calendar.subscriptions.remove",
		title: "Remove a calendar subscription",
		description:
			"Stops fetching it, takes its events off the calendar and forgets the address. Waits for the owner to approve.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: ID,
		prepare: async (args) => subscriptions.reviewRemove(String(args.id)),
		handler: async (args) => subscriptions.remove(String(args.id)),
	},
];
