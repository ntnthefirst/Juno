import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clients } from "../db/schema";
import {
	bucketFor,
	complete,
	create,
	history,
	list,
	reopen,
	snooze,
	update,
} from "./reminders";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
});

const base = { leadDays: 0, snoozedUntil: null, completedAt: null };

describe("bucketFor", () => {
	const today = "2026-05-10";

	it("sorts by the date", () => {
		expect(bucketFor({ ...base, dueOn: "2026-05-09" }, today)).toBe("overdue");
		expect(bucketFor({ ...base, dueOn: "2026-05-10" }, today)).toBe("today");
		expect(bucketFor({ ...base, dueOn: "2026-05-14" }, today)).toBe("soon");
		expect(bucketFor({ ...base, dueOn: "2026-08-01" }, today)).toBe("later");
	});

	it("puts a completed reminder in done regardless of its date", () => {
		expect(
			bucketFor({ ...base, dueOn: "2026-01-01", completedAt: "2026-01-02T00:00:00Z" }, today),
		).toBe("done");
	});

	it("hides a live snooze but not an expired one", () => {
		expect(bucketFor({ ...base, dueOn: "2026-05-01", snoozedUntil: "2026-05-20" }, today)).toBe(
			"snoozed",
		);
		// The snooze ran out yesterday, so the reminder is overdue again without
		// anything having to sweep the table.
		expect(bucketFor({ ...base, dueOn: "2026-05-01", snoozedUntil: "2026-05-09" }, today)).toBe(
			"overdue",
		);
	});

	it("pulls a reminder forward by its lead days", () => {
		// 30 days out is "later" normally, and "soon" with a month of lead.
		expect(bucketFor({ ...base, dueOn: "2026-06-05" }, today)).toBe("later");
		expect(bucketFor({ ...base, dueOn: "2026-06-05", leadDays: 30 }, today)).toBe("soon");
	});

	it("does not let lead days make something overdue early", () => {
		expect(bucketFor({ ...base, dueOn: "2026-06-05", leadDays: 365 }, today)).toBe("soon");
	});
});

describe("complete", () => {
	it("finishes a one-off", async () => {
		const made = await create({ title: "Send the thing", dueOn: "2026-05-10" }, db, "2026-05-10");
		const done = await complete(made.id, {}, db, "2026-05-10");

		expect(done.completedAt).not.toBeNull();
		expect(done.bucket).toBe("done");
		expect(await list({}, db, "2026-05-10")).toHaveLength(0);
	});

	it("rolls a recurring reminder forward instead of completing it", async () => {
		const made = await create(
			{ title: "VAT", dueOn: "2026-03-31", pattern: "quarter_end", interval: 1 },
			db,
			"2026-03-31",
		);
		const rolled = await complete(made.id, {}, db, "2026-03-31");

		expect(rolled.completedAt).toBeNull();
		expect(rolled.dueOn).toBe("2026-06-30");
		expect(rolled.lastCompletedOn).toBe("2026-03-31");
	});

	it("skips past missed occurrences rather than landing on the oldest", async () => {
		// A weekly reminder untouched for a month should land on the next future
		// week, not walk through every week that was missed.
		const made = await create(
			{ title: "Weekly", dueOn: "2026-01-05", pattern: "weeks", interval: 1 },
			db,
			"2026-01-05",
		);
		const rolled = await complete(made.id, {}, db, "2026-02-03");
		expect(rolled.dueOn > "2026-02-03").toBe(true);
		expect(rolled.dueOn).toBe("2026-02-09");
	});

	it("records the occurrence that was due, not the day it was ticked", async () => {
		const made = await create(
			{ title: "VAT", dueOn: "2026-03-31", pattern: "quarter_end", interval: 1 },
			db,
			"2026-03-31",
		);
		await complete(made.id, { note: "filed" }, db, "2026-04-04");

		const log = await history(made.id, db);
		expect(log).toHaveLength(1);
		expect(log[0]!.dueOn).toBe("2026-03-31");
		expect(log[0]!.note).toBe("filed");
	});

	it("clears a snooze, so a completed reminder does not come back snoozed", async () => {
		const made = await create(
			{ title: "Thing", dueOn: "2026-05-01", pattern: "months", interval: 1 },
			db,
			"2026-05-01",
		);
		await snooze(made.id, "2026-05-20", db, "2026-05-10");
		const rolled = await complete(made.id, {}, db, "2026-05-10");
		expect(rolled.snoozedUntil).toBeNull();
	});
});

describe("snooze", () => {
	it("refuses a date that is not in the future", async () => {
		const made = await create({ title: "Thing", dueOn: "2026-05-10" }, db, "2026-05-10");
		await expect(snooze(made.id, "2026-05-10", db, "2026-05-10")).rejects.toThrow(/future/);
		await expect(snooze(made.id, "2026-05-01", db, "2026-05-10")).rejects.toThrow(/future/);
	});

	it("keeps the reminder open, just quiet", async () => {
		const made = await create({ title: "Thing", dueOn: "2026-05-01" }, db, "2026-05-10");
		const snoozed = await snooze(made.id, "2026-05-20", db, "2026-05-10");
		expect(snoozed.completedAt).toBeNull();
		expect(snoozed.bucket).toBe("snoozed");
	});
});

describe("list", () => {
	it("hides done reminders unless asked", async () => {
		const made = await create({ title: "One off", dueOn: "2026-05-10" }, db, "2026-05-10");
		await complete(made.id, {}, db, "2026-05-10");

		expect(await list({}, db, "2026-05-10")).toHaveLength(0);
		expect(await list({ includeDone: true }, db, "2026-05-10")).toHaveLength(1);
	});

	it("actionableOnly keeps overdue, today and soon", async () => {
		await create({ title: "Overdue", dueOn: "2026-05-01" }, db, "2026-05-10");
		await create({ title: "Today", dueOn: "2026-05-10" }, db, "2026-05-10");
		await create({ title: "Soon", dueOn: "2026-05-13" }, db, "2026-05-10");
		await create({ title: "Later", dueOn: "2026-12-01" }, db, "2026-05-10");

		const actionable = await list({ actionableOnly: true }, db, "2026-05-10");
		expect(actionable.map((r) => r.title).sort()).toEqual(["Overdue", "Soon", "Today"]);
	});

	it("resolves the client name for a linked reminder", async () => {
		const [client] = db
			.insert(clients)
			.values({ name: "obet", sortName: "obet" })
			.returning()
			.all();
		await create(
			{ title: "Invoice obet", dueOn: "2026-05-10", clientId: client!.id },
			db,
			"2026-05-10",
		);

		const rows = await list({}, db, "2026-05-10");
		expect(rows[0]!.clientName).toBe("obet");
	});
});

describe("reopen", () => {
	it("brings a completed one-off back", async () => {
		const made = await create({ title: "Thing", dueOn: "2026-05-10" }, db, "2026-05-10");
		await complete(made.id, {}, db, "2026-05-10");
		const back = await reopen(made.id, db, "2026-05-10");
		expect(back.completedAt).toBeNull();
		expect(back.bucket).toBe("today");
	});
});

describe("anchor day", () => {
	it("is derived from the due date for a monthly series", async () => {
		const made = await create(
			{ title: "Month end", dueOn: "2026-01-31", pattern: "months", interval: 1 },
			db,
			"2026-01-31",
		);
		expect(made.anchorDay).toBe(31);
	});

	it("keeps a month-end series on the month end instead of walking backwards", async () => {
		// The bug this exists to stop: clamp to 28 February once, then advance from
		// the clamped date, and every later occurrence is on the 28th.
		const made = await create(
			{ title: "Month end", dueOn: "2026-01-31", pattern: "months", interval: 1 },
			db,
			"2026-01-31",
		);

		const feb = await complete(made.id, {}, db, "2026-01-31");
		expect(feb.dueOn).toBe("2026-02-28");

		const mar = await complete(made.id, {}, db, "2026-02-28");
		expect(mar.dueOn).toBe("2026-03-31");

		const apr = await complete(made.id, {}, db, "2026-03-31");
		expect(apr.dueOn).toBe("2026-04-30");

		const may = await complete(made.id, {}, db, "2026-04-30");
		expect(may.dueOn).toBe("2026-05-31");
	});

	it("is null for a pattern that does not need one", async () => {
		const made = await create(
			{ title: "Weekly", dueOn: "2026-01-31", pattern: "weeks", interval: 1 },
			db,
			"2026-01-31",
		);
		expect(made.anchorDay).toBeNull();
	});

	it("is recomputed when the date moves", async () => {
		const made = await create(
			{ title: "Monthly", dueOn: "2026-01-15", pattern: "months", interval: 1 },
			db,
			"2026-01-15",
		);
		expect(made.anchorDay).toBe(15);

		const moved = await update(made.id, { dueOn: "2026-01-31" }, db, "2026-01-15");
		expect(moved.anchorDay).toBe(31);
	});
});
