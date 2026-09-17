import * as search from "../services/search";
import type { ToolDescriptor } from "./types";

export const searchTools: ToolDescriptor[] = [
	{
		name: "search.global",
		title: "Search everything",
		description:
			"Search clients, projects and contacts at once and get back id, kind and a label for each match. This is how a name becomes an id: call it first, then pass the id to a tool that needs one.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				term: {
					type: "string",
					description: "What to look for. Matched case-insensitively anywhere in the text.",
				},
				limit: { type: "integer", description: "Matches to return. Defaults to 20, maximum 100." },
			},
			required: ["term"],
			additionalProperties: false,
		},
		handler: (args) => search.global(args.term as string, args.limit as number | undefined),
	},
];
