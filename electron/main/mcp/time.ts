/**
 * The agent's view of time spent on projects.
 *
 * Every write here touches this machine and nothing else, so none of them can
 * send, sign, file or delete anything. They are still side-effectful, which is
 * what keeps them out of anything that runs on a schedule with nobody watching,
 * and they park for approval like every other write until the Allow setting
 * for records lands. Removing an entry has no tool.
 */
import * as time from "../services/time-entries";
import type { TimeEntryInput, TimeEntryPatch } from "../../shared/types";
import type { ToolDescriptor } from "./types";

const NOTE = {
	type: ["string", "null"],
	description: "What the time was spent on. Shown as the title of the entry.",
} as const;

const MINUTES = {
	type: "integer",
	description: "Whole minutes. 1 h 30 is 90.",
} as const;

const STARTED = {
	type: "string",
	description: "When it started, as a UTC time like 2026-03-14T09:05:00.000Z.",
} as const;

export const timeTools: ToolDescriptor[] = [
	{
		name: "time.list",
		title: "List a project's time entries",
		description:
			"The time entries of one project, newest first, with the running timer included if it is on this project. " +
			"Durations are whole minutes and times are UTC. Also returns the totals: minutes logged, the estimate and the entry count.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { project_id: { type: "string", description: "The id of the project, from projects.list." } },
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const projectId = args.project_id as string;
			const [entries, totals] = await Promise.all([time.list(projectId), time.total(projectId)]);
			return { entries, totals };
		},
	},
	{
		name: "time.start",
		title: "Start the timer on a project",
		description:
			"Starts the timer. Only one timer runs at a time, so this fails while another is running; stop that one first with time.stop.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "The id of the project, from projects.list." },
				note: NOTE,
			},
			required: ["project_id"],
			additionalProperties: false,
		},
		handler: (args) => time.start(args.project_id as string, args.note as string | null | undefined),
	},
	{
		name: "time.stop",
		title: "Stop the running timer",
		description:
			"Stops the timer that is running and records its whole minutes, at least one. Fails when no timer is running.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { note: NOTE },
			additionalProperties: false,
		},
		handler: (args) => time.stop(args.note as string | null | undefined),
	},
	{
		name: "time.create",
		title: "Add a time entry",
		description:
			"Adds time that was already spent. Give the duration in whole minutes; the start defaults to that long before now.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "The id of the project, from projects.list." },
				duration_minutes: MINUTES,
				started_at: STARTED,
				note: NOTE,
			},
			required: ["project_id", "duration_minutes"],
			additionalProperties: false,
		},
		handler: (args) => {
			const input: TimeEntryInput = {
				projectId: args.project_id as string,
				durationMinutes: args.duration_minutes as number,
			};
			if (typeof args.started_at === "string") input.startedAt = args.started_at;
			if ("note" in args) input.note = args.note as string | null;
			return time.create(input);
		},
	},
	{
		name: "time.update",
		title: "Change a time entry",
		description:
			"Changes the note, the start or the duration of one entry. Fields left out are untouched. A running timer can only have its note changed.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				entry_id: { type: "string", description: "The id of the entry, from time.list." },
				duration_minutes: MINUTES,
				started_at: STARTED,
				note: NOTE,
			},
			required: ["entry_id"],
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: TimeEntryPatch = {};
			if (typeof args.duration_minutes === "number") patch.durationMinutes = args.duration_minutes;
			if (typeof args.started_at === "string") patch.startedAt = args.started_at;
			if ("note" in args) patch.note = args.note as string | null;
			return time.update(args.entry_id as string, patch);
		},
	},
];
