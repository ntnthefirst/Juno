import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import {
	approve,
	configureAgentActions,
	reject,
	request,
	resetForTests as resetActions,
} from "./agent-actions";
import {
	cancelRun,
	configureAutomations,
	create,
	due,
	get,
	isoWeekday,
	list,
	remove,
	resetForTests,
	resumeForAction,
	run,
	runs,
	setEnabled,
	update,
} from "./automations";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let db: Db;
/** Tools the fake runtime knows about, and what each does when called. */
let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
/** Which tools the fake gate parks instead of running. */
let gated: Set<string>;
let calls: string[];

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
	resetActions();
	resetForTests();
	calls = [];
	gated = new Set();
	handlers = {
		"reminders.list": async () => [{ id: "r1" }, { id: "r2" }],
		"clients.create": async (args) => ({ id: "c1", name: args.name }),
		"mail.send": async () => ({ id: "m1" }),
		"broken.tool": async () => {
			throw new Error("The server said no.");
		},
	};

	// Stands in for the host: a gated tool parks an action, anything else runs.
	configureAutomations({
		hasTool: (name) => name in handlers,
		callTool: async (tool, args, options) => {
			calls.push(tool);
			if (gated.has(tool)) {
				const action = await request(
					{
						toolName: tool,
						args,
						summary: tool,
						source: "automation",
						automationRunId: options.automationRunId,
					},
					db,
				);
				return { status: "pending", actionId: action.id, summary: action.summary };
			}
			return handlers[tool]!(args);
		},
	});
	configureAgentActions(async (tool, args) => handlers[tool]!(args));
});

afterEach(() => {
	vi.useRealTimers();
	resetActions();
	resetForTests();
});

async function twoSteps() {
	return create(
		{
			name: "Morning check",
			steps: [
				{ tool: "reminders.list", args: { actionable_only: true } },
				{ tool: "clients.create", args: { name: "obet" } },
			],
		},
		db,
	);
}

describe("create", () => {
	it("stores the steps and defaults to a manual trigger", async () => {
		const made = await twoSteps();
		expect(made.trigger).toEqual({ kind: "manual" });
		expect(made.steps).toHaveLength(2);
		expect(made.enabled).toBe(true);
		expect(made.lastStatus).toBeNull();
	});

	it("refuses a step naming a tool that does not exist", async () => {
		await expect(
			create({ name: "x", steps: [{ tool: "nope.invented", args: {} }] }, db),
		).rejects.toThrow(/not a tool/);
	});

	it("refuses an empty automation and a bad trigger", async () => {
		await expect(create({ name: "x", steps: [] }, db)).rejects.toThrow(/at least one step/);
		await expect(
			create({ name: "x", steps: [{ tool: "reminders.list", args: {} }], trigger: { kind: "daily", time: "25:00" } }, db),
		).rejects.toThrow(/time of day/);
		await expect(
			create(
				{ name: "x", steps: [{ tool: "reminders.list", args: {} }], trigger: { kind: "weekly", weekday: 9, time: "08:00" } },
				db,
			),
		).rejects.toThrow(/1 for Monday/);
	});
});

describe("run", () => {
	it("walks every step and logs what each returned", async () => {
		const made = await twoSteps();
		const result = await run(made.id, "manual", db);

		expect(result.status).toBe("done");
		expect(calls).toEqual(["reminders.list", "clients.create"]);
		expect(result.log.map((entry) => [entry.tool, entry.outcome, entry.detail])).toEqual([
			["reminders.list", "ran", "2 rows"],
			["clients.create", "ran", "obet"],
		]);
		expect(result.finishedAt).not.toBeNull();
		expect((await get(made.id, db))?.lastStatus).toBe("done");
	});

	it("stops at a step that needs a person and does not run what comes after", async () => {
		gated.add("clients.create");
		const made = await twoSteps();
		const result = await run(made.id, "manual", db);

		expect(result.status).toBe("waiting");
		expect(result.stoppedAtStep).toBe(1);
		expect(result.finishedAt).toBeNull();
		expect(result.log[1]).toMatchObject({ tool: "clients.create", outcome: "waiting" });
		expect(result.log[1]!.actionId).toBeTruthy();
	});

	it("picks the run up from the next step once the person approves", async () => {
		gated.add("clients.create");
		const made = await create(
			{
				name: "Three",
				steps: [
					{ tool: "reminders.list", args: {} },
					{ tool: "clients.create", args: { name: "obet" } },
					{ tool: "reminders.list", args: {} },
				],
			},
			db,
		);
		const first = await run(made.id, "manual", db);
		const actionId = first.log[1]!.actionId!;

		await approve(actionId, db);
		const resumed = await resumeForAction(actionId, "executed", db);

		expect(resumed?.status).toBe("done");
		expect(resumed?.log.map((entry) => entry.outcome)).toEqual(["ran", "ran", "ran"]);
		expect(calls).toEqual(["reminders.list", "clients.create", "reminders.list"]);
	});

	it("ends the run when the person says no, and never runs the rest", async () => {
		gated.add("clients.create");
		const made = await create(
			{
				name: "Three",
				steps: [
					{ tool: "reminders.list", args: {} },
					{ tool: "clients.create", args: { name: "obet" } },
					{ tool: "reminders.list", args: {} },
				],
			},
			db,
		);
		const first = await run(made.id, "manual", db);
		const actionId = first.log[1]!.actionId!;

		await reject(actionId, db);
		const stopped = await resumeForAction(actionId, "rejected", db);

		expect(stopped?.status).toBe("cancelled");
		// Two calls: the list, and the request that was refused. Never the third step.
		expect(calls).toEqual(["reminders.list", "clients.create"]);
	});

	it("stops on a step that throws and says which one", async () => {
		const made = await create(
			{
				name: "Breaks",
				steps: [
					{ tool: "reminders.list", args: {} },
					{ tool: "broken.tool", args: {} },
					{ tool: "reminders.list", args: {} },
				],
			},
			db,
		);
		const result = await run(made.id, "manual", db);

		expect(result.status).toBe("failed");
		expect(result.stoppedAtStep).toBe(1);
		expect(result.error).toBe("The server said no.");
		expect(calls).toEqual(["reminders.list", "broken.tool"]);
	});

	it("cancelling a waiting run refuses the step it was waiting on", async () => {
		gated.add("clients.create");
		const made = await twoSteps();
		const waiting = await run(made.id, "manual", db);
		const actionId = waiting.log[1]!.actionId!;

		const cancelled = await cancelRun(waiting.id, db);
		expect(cancelled.status).toBe("cancelled");
		// Approving afterwards would otherwise restart a run somebody stopped.
		await expect(approve(actionId, db)).rejects.toThrow(/already rejected/);
	});

	it("keeps a history of runs", async () => {
		const made = await twoSteps();
		await run(made.id, "manual", db);
		await run(made.id, "schedule", db, "2026-09-21");
		const history = await runs(made.id, 10, db);
		expect(history).toHaveLength(2);
		expect(history.every((entry) => entry.automationName === "Morning check")).toBe(true);
		expect(history.map((entry) => entry.startedBy)).toContain("schedule");
	});
});

describe("triggers", () => {
	it("records the local date it ran on, never the UTC one", async () => {
		// 00:30 in Brussels is still yesterday in UTC. Recording the UTC date
		// would leave a daily automation due again and run it twice.
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-22T22:30:00.000Z"));
		const made = await create(
			{ name: "Nightly", steps: [{ tool: "reminders.list", args: {} }], trigger: { kind: "daily", time: "00:15" } },
			db,
		);
		await run(made.id, "schedule", db, "2026-09-23");
		expect((await get(made.id, db))?.lastRunOn).toBe("2026-09-23");
		expect(await due("2026-09-23", "00:30", db)).toHaveLength(0);
	});

	it("counts weekdays from Monday", () => {
		expect(isoWeekday("2026-09-21")).toBe(1);
		expect(isoWeekday("2026-09-27")).toBe(7);
	});

	it("is due at or after its time, once a day", async () => {
		const made = await create(
			{ name: "Daily", steps: [{ tool: "reminders.list", args: {} }], trigger: { kind: "daily", time: "08:30" } },
			db,
		);
		expect(await due("2026-09-21", "08:29", db)).toHaveLength(0);
		expect(await due("2026-09-21", "08:30", db)).toHaveLength(1);
		// A machine that was asleep at 08:30 still runs it when it comes back.
		expect(await due("2026-09-21", "14:00", db)).toHaveLength(1);

		await run(made.id, "schedule", db, "2026-09-21");
		expect(await due("2026-09-21", "14:00", db)).toHaveLength(0);
		// A new day makes it due again.
		expect(await due("2026-09-22", "08:30", db)).toHaveLength(1);
	});

	it("only fires a weekly trigger on its own weekday", async () => {
		await create(
			{
				name: "Weekly",
				steps: [{ tool: "reminders.list", args: {} }],
				trigger: { kind: "weekly", weekday: 2, time: "09:00" },
			},
			db,
		);
		expect(await due("2026-09-21", "10:00", db)).toHaveLength(0);
		expect(await due("2026-09-22", "10:00", db)).toHaveLength(1);
	});

	it("never fires a manual one, or a disabled one", async () => {
		const manual = await twoSteps();
		expect(await due("2026-09-21", "23:59", db)).toHaveLength(0);

		const daily = await create(
			{ name: "Daily", steps: [{ tool: "reminders.list", args: {} }], trigger: { kind: "daily", time: "08:00" } },
			db,
		);
		await setEnabled(daily.id, false, db);
		expect(await due("2026-09-21", "09:00", db)).toHaveLength(0);
		await remove(manual.id, db);
		expect(await list(db)).toHaveLength(1);
	});
});

describe("update", () => {
	it("changes the steps and re-checks them", async () => {
		const made = await twoSteps();
		const changed = await update(made.id, { steps: [{ tool: "reminders.list", args: {} }] }, db);
		expect(changed.steps).toHaveLength(1);
		await expect(update(made.id, { steps: [{ tool: "nope.invented", args: {} }] }, db)).rejects.toThrow(
			/not a tool/,
		);
	});
});
