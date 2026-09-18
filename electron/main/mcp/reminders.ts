import type { ReminderCategory, ReminderPatch, RecurrencePattern } from "../../shared/types";
import * as derive from "../services/reminders-derive";
import * as reminders from "../services/reminders";
import type { ToolDescriptor } from "./types";

/**
 * Reminder tools.
 *
 * This is the surface an assistant is most useful on: "what needs attention"
 * is the question the whole feature exists to answer, and it is read-only.
 *
 * Completing and snoozing are exposed, unlike signing a document, because both
 * are reversible: `reminders.reopen` undoes a completion and a snooze simply
 * runs out. They still require confirmation, because "done" is a claim about
 * the world.
 *
 * Nothing here raises an invoice or moves money. Decision 9 is a product
 * boundary, not a missing feature: an invoice reminder carries a link and stops.
 */

const CATEGORIES: ReminderCategory[] = ["paperwork", "invoice", "payment", "renewal", "other"];
const PATTERNS: RecurrencePattern[] = [
	"once",
	"days",
	"weeks",
	"months",
	"years",
	"quarter_end",
];

export const reminderTools: ToolDescriptor[] = [
	{
		name: "reminders.list",
		title: "List reminders",
		description:
			"Reminders with a computed bucket: overdue, today, soon, later, snoozed or done. " +
			"Use actionable_only for what wants attention now, which is the usual question.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				actionable_only: {
					type: "boolean",
					description: "Only overdue, due today, or inside their lead time.",
				},
				include_done: { type: "boolean", description: "Include completed one-offs." },
				client_id: { type: "string" },
				category: { type: "string", enum: CATEGORIES },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			reminders.list({
				actionableOnly: args.actionable_only === true,
				includeDone: args.include_done === true,
				...(args.client_id ? { clientId: String(args.client_id) } : {}),
				...(args.category ? { category: args.category as ReminderCategory } : {}),
			}),
	},
	{
		name: "reminders.get",
		title: "Read a reminder",
		description: "One reminder, including its recurrence and what it hangs off.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => reminders.get(String(args.id)),
	},
	{
		name: "reminders.suggestions",
		title: "List suggested reminders",
		description:
			"Reminders worked out from the records rather than stored: projects marked delivered " +
			"with a value and no invoice reminder, and deadlines approaching without one. " +
			"Offers, not commitments. Accept one with reminders.accept.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => derive.suggestions(),
	},
	{
		name: "reminders.create",
		title: "Create a reminder",
		description:
			"Adds a reminder. Recurrence is a small fixed set: once, every N days, weeks, months " +
			"or years, or the end of every quarter.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				due_on: { type: "string", description: "YYYY-MM-DD." },
				notes: { type: ["string", "null"] },
				pattern: { type: "string", enum: PATTERNS },
				interval: { type: "integer", minimum: 1, description: "Ignored by once and quarter_end." },
				anchor_day: {
					type: ["integer", "null"],
					description:
						"Day of the month a monthly or yearly series returns to after a short month clamps it.",
				},
				lead_days: {
					type: "integer",
					minimum: 0,
					maximum: 365,
					description: "How many days ahead it starts asking.",
				},
				category: { type: "string", enum: CATEGORIES },
				client_id: { type: ["string", "null"] },
				project_id: { type: ["string", "null"] },
				action_url: {
					type: ["string", "null"],
					description: "Where to go to do it. Bureau never does it itself.",
				},
				action_label: { type: ["string", "null"] },
			},
			required: ["title", "due_on"],
			additionalProperties: false,
		},
		handler: async (args) =>
			reminders.create({
				title: String(args.title),
				dueOn: String(args.due_on),
				notes: (args.notes as string | null) ?? null,
				...(args.pattern ? { pattern: args.pattern as RecurrencePattern } : {}),
				...(args.interval !== undefined ? { interval: Number(args.interval) } : {}),
				...(args.anchor_day !== undefined ? { anchorDay: args.anchor_day as number | null } : {}),
				...(args.lead_days !== undefined ? { leadDays: Number(args.lead_days) } : {}),
				...(args.category ? { category: args.category as ReminderCategory } : {}),
				clientId: (args.client_id as string | null) ?? null,
				projectId: (args.project_id as string | null) ?? null,
				actionUrl: (args.action_url as string | null) ?? null,
				actionLabel: (args.action_label as string | null) ?? null,
			}),
	},
	{
		name: "reminders.update",
		title: "Edit a reminder",
		description: "Changes any field of a reminder.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				title: { type: "string" },
				due_on: { type: "string" },
				notes: { type: ["string", "null"] },
				pattern: { type: "string", enum: PATTERNS },
				interval: { type: "integer", minimum: 1 },
				lead_days: { type: "integer", minimum: 0, maximum: 365 },
				category: { type: "string", enum: CATEGORIES },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const patch: ReminderPatch = {
				...(args.title !== undefined ? { title: String(args.title) } : {}),
				...(args.due_on !== undefined ? { dueOn: String(args.due_on) } : {}),
				...(args.notes !== undefined ? { notes: args.notes as string | null } : {}),
				...(args.pattern !== undefined ? { pattern: args.pattern as RecurrencePattern } : {}),
				...(args.interval !== undefined ? { interval: Number(args.interval) } : {}),
				...(args.lead_days !== undefined ? { leadDays: Number(args.lead_days) } : {}),
				...(args.category !== undefined ? { category: args.category as ReminderCategory } : {}),
			};
			return reminders.update(String(args.id), patch);
		},
	},
	{
		name: "reminders.complete",
		title: "Tick a reminder off",
		description:
			"A one-off is finished. A recurring one rolls forward to its next occurrence after " +
			"today, so a quarterly reminder left for six months lands on the next quarter rather " +
			"than the one that was missed. Reversible with reminders.reopen.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, note: { type: ["string", "null"] } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			reminders.complete(String(args.id), { note: (args.note as string | null) ?? null }),
	},
	{
		name: "reminders.snooze",
		title: "Snooze a reminder",
		description:
			"Pushes a reminder out without pretending it is done. The date has to be in the future.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, until: { type: "string", description: "YYYY-MM-DD." } },
			required: ["id", "until"],
			additionalProperties: false,
		},
		handler: async (args) => reminders.snooze(String(args.id), String(args.until)),
	},
	{
		name: "reminders.reopen",
		title: "Reopen a reminder",
		description: "Undoes a completion or a snooze.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => reminders.reopen(String(args.id)),
	},
	{
		name: "reminders.history",
		title: "Read a reminder's history",
		description:
			"Every time this reminder was ticked off, by the date the occurrence was due rather " +
			"than the day it was ticked. Answers whether the last quarter was actually filed.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => reminders.history(String(args.id)),
	},
];
