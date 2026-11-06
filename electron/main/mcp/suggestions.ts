import * as suggestions from "../services/suggestions";
import type { ToolDescriptor } from "./types";

export const suggestionTools: ToolDescriptor[] = [
	{
		name: "suggestions.list",
		title: "List suggestions for a message",
		description:
			"What Juno would offer under this message: a calendar event when the words give a day " +
			"and a time. Each has a one-line headline and the question a person is asked. Nothing " +
			"is created by listing. To act on one, use calendar.create_event with the same title " +
			"and time. Empty when there is none, when the person pressed Not now, or when that " +
			"source is switched off.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { message_id: { type: "string", description: "A message id, from mail.threads.get." } },
			required: ["message_id"],
			additionalProperties: false,
		},
		handler: async (args) => suggestions.forMessage(String(args.message_id)),
	},
];
