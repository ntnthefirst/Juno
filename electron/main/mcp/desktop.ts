/**
 * The agent surface for toasts, the tray icon and the taskbar badge.
 *
 * What is deliberately not here: **the global shortcut**. It takes a key
 * combination away from every other program on the machine, which is a
 * person's choice to make at the settings page. Nor is there a tool that
 * presses a button on a toast or opens a window: the agent operates the
 * business, not the interface (.claude/rules/mcp.md section 7).
 */
import * as desktop from "../services/desktop";
import type { ToolDescriptor } from "./types";

export const desktopTools: ToolDescriptor[] = [
	{
		name: "desktop.get",
		title: "Notification and tray settings",
		description:
			"Whether Windows notifications, the tray icon and the taskbar badge are on, whether the " +
			"shortcut for a new note is on and whether Juno could take it, and whether closing the window " +
			"keeps Juno running. supported is false off Windows.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => desktop.getView(),
	},
	{
		name: "desktop.update",
		title: "Change notification and tray settings",
		description:
			"Turns Windows notifications, the tray icon or the taskbar badge on or off. Give only the " +
			"ones to change. The tray icon stays while Juno runs without a window, whatever tray says. " +
			"The shortcut and running in the background are not changed here.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				toasts: { type: "boolean", description: "Show Windows notifications." },
				tray: { type: "boolean", description: "Keep an icon in the notification area." },
				badge: {
					type: "boolean",
					description: "Show the number of agent requests waiting on the taskbar button.",
				},
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			desktop.update({
				...(typeof args.toasts === "boolean" ? { toasts: args.toasts } : {}),
				...(typeof args.tray === "boolean" ? { tray: args.tray } : {}),
				...(typeof args.badge === "boolean" ? { badge: args.badge } : {}),
			}),
	},
];

export default desktopTools;
