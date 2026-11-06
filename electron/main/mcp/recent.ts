import * as recent from "../services/recent";
import type { ToolDescriptor } from "./types";

export const recentTools: ToolDescriptor[] = [
	{
		name: "recent.list",
		title: "List recently opened records",
		description:
			"The clients, projects, documents and mail conversations the person opened last, newest " +
			"first, at most twenty, each with its id, kind, name and the client it belongs to. Use it " +
			"to answer what the person was just working on.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => recent.list(),
	},
];
