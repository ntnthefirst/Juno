import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clients, projects } from "../db/schema";
import { configureAgentActions, request, resetForTests } from "./agent-actions";
import { client, month, today } from "./briefing";
import * as calendar from "./calendar";
import * as reminders from "./reminders";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const BRU = "Europe/Brussels";
const TODAY = "2026-09-22";

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
	resetForTests();
});

function section(briefing: Awaited<ReturnType<typeof today>>, key: string) {
	const found = briefing.sections.find((s) => s.key === key);
	if (!found) throw new Error(`No section ${key}`);
	return found;
}

describe("today", () => {
	it("says so plainly when there is nothing", async () => {
		const briefing = await today(db, TODAY, BRU);
		expect(briefing.headline).toBe("Nothing is overdue, due today or waiting on you.");
		expect(briefing.sections.every((s) => s.items.length === 0)).toBe(true);
		expect(section(briefing, "reminders").emptyText).toBe("Nothing is due.");
	});

	it("counts what is overdue, due and scheduled in one sentence", async () => {
		await reminders.create({ title: "File the VAT return", dueOn: "2026-09-18" }, db, TODAY);
		await reminders.create({ title: "Chase the deposit", dueOn: TODAY }, db, TODAY);
		await calendar.create(
			{ title: "Call with obet", startLocal: `${TODAY}T10:00`, endLocal: `${TODAY}T10:30`, timezone: BRU },
			db,
		);

		const briefing = await today(db, TODAY, BRU);
		expect(briefing.headline).toBe(
			"1 reminder is overdue, 1 reminder due today and 1 event on the calendar.",
		);
		expect(section(briefing, "reminders").items.map((item) => item.title)).toEqual([
			"File the VAT return",
			"Chase the deposit",
		]);
		expect(section(briefing, "reminders").items[0]!.urgent).toBe(true);
		expect(section(briefing, "today").items.map((item) => item.title)).toEqual(["Call with obet"]);
	});

	it("separates what is on today from what is coming", async () => {
		await calendar.create(
			{ title: "Today", startLocal: `${TODAY}T10:00`, endLocal: `${TODAY}T10:30`, timezone: BRU },
			db,
		);
		await calendar.create(
			{ title: "Friday", startLocal: "2026-09-25T10:00", endLocal: "2026-09-25T10:30", timezone: BRU },
			db,
		);
		await calendar.create(
			{ title: "Next month", startLocal: "2026-10-20T10:00", endLocal: "2026-10-20T10:30", timezone: BRU },
			db,
		);

		const briefing = await today(db, TODAY, BRU);
		expect(section(briefing, "today").items.map((item) => item.title)).toEqual(["Today"]);
		expect(section(briefing, "upcoming").items.map((item) => item.title)).toEqual(["Friday"]);
	});

	it("puts a request waiting for a person at the top of what is waiting", async () => {
		configureAgentActions(async () => ({}));
		await request(
			{ toolName: "clients.create", args: { name: "obet" }, summary: "Create a client (name: obet)", source: "mcp" },
			db,
		);

		const briefing = await today(db, TODAY, BRU);
		const waiting = section(briefing, "waiting");
		expect(waiting.items[0]).toMatchObject({
			kind: "action",
			title: "Create a client (name: obet)",
			urgent: true,
		});
		expect(briefing.headline).toContain("1 request waiting for you");
	});

	it("carries the id of every item, so each can be clicked through", async () => {
		const reminder = await reminders.create({ title: "x", dueOn: TODAY }, db, TODAY);
		const briefing = await today(db, TODAY, BRU);
		expect(section(briefing, "reminders").items[0]!.id).toBe(reminder.id);
	});
});

describe("client", () => {
	it("answers where one client stands", async () => {
		const [record] = db.insert(clients).values({ name: "obet", sortName: "obet" }).returning().all();
		db.insert(projects).values({ clientId: record!.id, name: "Site", dueOn: "2026-09-30" }).run();
		await reminders.create({ title: "Chase the deposit", dueOn: TODAY, clientId: record!.id }, db, TODAY);

		const briefing = await client(record!.id, db, TODAY);
		expect(briefing.title).toBe("obet");
		// The name is used as it is written. A business called "obet" is not "Obet".
		expect(briefing.headline).toBe("obet has 1 open project and 1 open reminder.");
		expect(briefing.sections.find((s) => s.key === "projects")!.items[0]!.title).toBe("Site");
		expect(briefing.sections.find((s) => s.key === "reminders")!.items[0]!.title).toBe("Chase the deposit");
	});

	it("refuses a client that is not there", async () => {
		await expect(client("nope", db, TODAY)).rejects.toThrow(/No client/);
	});
});

describe("month", () => {
	it("gathers paperwork, deadlines and events for the month", async () => {
		const [record] = db.insert(clients).values({ name: "obet", sortName: "obet" }).returning().all();
		db.insert(projects).values({ clientId: record!.id, name: "Site", dueOn: "2026-10-14" }).run();
		await reminders.create({ title: "Quarterly VAT", dueOn: "2026-10-20" }, db, TODAY);
		await calendar.create(
			{ title: "Review", startLocal: "2026-10-06T10:00", endLocal: "2026-10-06T11:00", timezone: BRU },
			db,
		);
		// Outside the month, so none of these may appear.
		await reminders.create({ title: "November thing", dueOn: "2026-11-02" }, db, TODAY);

		const briefing = await month("2026-10", db, TODAY, BRU);
		expect(briefing.from).toBe("2026-10-01");
		expect(briefing.to).toBe("2026-10-31");
		expect(briefing.headline).toBe("1 piece of paperwork due, 1 project deadline and 1 event.");
		expect(briefing.sections.find((s) => s.key === "paperwork")!.items.map((i) => i.title)).toEqual([
			"Quarterly VAT",
		]);
		expect(briefing.sections.find((s) => s.key === "deadlines")!.items[0]!.title).toBe("Site is due");
	});

	it("gets February's length right, and refuses something that is not a month", async () => {
		const briefing = await month("2028-02", db, TODAY, BRU);
		expect(briefing.to).toBe("2028-02-29");
		await expect(month("2026-13", db, TODAY, BRU)).rejects.toThrow(/not a month/);
		await expect(month("October", db, TODAY, BRU)).rejects.toThrow(/not a month/);
	});
});
