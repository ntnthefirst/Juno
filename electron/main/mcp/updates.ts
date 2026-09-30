/**
 * The agent surface for updates.
 *
 * What is deliberately not here: **installing one**. Installing quits Juno and
 * relaunches it, and an agent that can restart the application it is driving
 * can end a session that a person is in the middle of. That is the same answer
 * as the lock, for the same reason: there is no app.unlock either
 * (.claude/rules/security.md section 8). Auto-install can be turned on, and
 * then the install happens at a close a person chose.
 */
import * as updates from "../services/updates";
import type { ToolDescriptor } from "./types";

export const updateTools: ToolDescriptor[] = [
	{
		name: "updates.status",
		title: "Update status",
		description:
			"The running version, whether a newer release was found, how far a download has got, " +
			"when the last check ran and when the next one is due. stage is unsupported in a " +
			"development build, where there is nothing to compare against.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => updates.status(),
	},
	{
		name: "updates.check",
		title: "Check for updates",
		description:
			"Looks at the published releases for a newer version and returns the status. Nothing is " +
			"installed. It downloads in the background only when auto-install is on. Rate-limited to " +
			"three checks a minute, shared with the button in settings, so a loop fails rather than " +
			"hammering the feed.",
		readOnly: false,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => updates.check({ manual: true }),
	},
	{
		name: "updates.set_auto_install",
		title: "Turn auto-install on or off",
		description:
			"On: a newer release downloads in the background and is applied when Juno is next closed, " +
			"so the following launch is the new version. Off: nothing is downloaded until a person " +
			"presses Install in settings. Never restarts the app either way.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				auto_install: { type: "boolean", description: "True to install updates automatically." },
			},
			required: ["auto_install"],
			additionalProperties: false,
		},
		handler: async (args) => updates.setAutoInstall(args.auto_install === true),
	},
];

export default updateTools;
