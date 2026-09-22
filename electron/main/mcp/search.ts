import type { SearchKind } from "../../shared/types";
import * as search from "../services/search";
import type { ToolDescriptor } from "./types";

const KINDS: SearchKind[] = ["client", "project", "contact", "document", "event", "mail"];

export const searchTools: ToolDescriptor[] = [
	{
		name: "search.global",
		title: "Search everything",
		description:
			"Search clients, projects, contacts, documents, calendar events and mail at once, and get " +
			"back id, kind and a label for each match. This is how a name becomes an id: call it " +
			"first, then pass the id to a tool that needs one. Narrow it with kinds when the answer " +
			"is obviously one sort of thing.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				term: {
					type: "string",
					description: "What to look for. Matched case-insensitively anywhere in the text.",
				},
				kinds: {
					type: "array",
					items: { type: "string", enum: KINDS },
					description: "Which sorts of record to search. Left out means all of them.",
				},
				limit: { type: "integer", description: "Matches to return. Defaults to 20, maximum 100." },
			},
			required: ["term"],
			additionalProperties: false,
		},
		handler: (args) =>
			search.query({
				term: String(args.term),
				...(Array.isArray(args.kinds) ? { kinds: args.kinds as SearchKind[] } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
			}),
	},
];
