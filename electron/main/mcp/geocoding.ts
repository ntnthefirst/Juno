import { lookupAddress, suggestLocations } from "../services/geocoding";
import type { ToolDescriptor } from "./types";

/**
 * Location matches for an event, same shape as mail.accounts.guess and
 * mail.accounts.look_up: a free lookup against this database first, a network
 * lookup second and only when asked for.
 */
export const geocodingTools: ToolDescriptor[] = [
	{
		name: "geocoding.suggest_locations",
		title: "Suggest an event location",
		description:
			"Matches from this database: a client's stored address, or a location typed on a past event. " +
			"Nothing is fetched over the network, so this is safe to call freely.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "What has been typed so far, for example a client name or a street." },
			},
			required: ["query"],
			additionalProperties: false,
		},
		handler: async (args) => suggestLocations(String(args.query)),
	},
	{
		name: "geocoding.lookup_address",
		title: "Look up a real-world address",
		description:
			"Sends the given text to OpenStreetMap's address search and returns matching addresses with " +
			"coordinates. Makes a network request; use only when a real address lookup is actually wanted, " +
			"not for every event location, since most of them are not addresses at all.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "The text to look up, for example a street and city." },
			},
			required: ["query"],
			additionalProperties: false,
		},
		handler: async (args) => lookupAddress(String(args.query)),
	},
];
