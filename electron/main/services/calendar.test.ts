import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CalendarOccurrence } from "../../shared/types";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clients, projects } from "../db/schema";
import { create, exportIcs, get, importIcs, listRange, remove, restore, update } from "./calendar";
import * as reminders from "./reminders";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const BRU = "Europe/Brussels";

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
});

async function events(from: string, to: string, extra: Partial<Parameters<typeof listRange>[0]> = {}) {
	const items = await listRange({ from, to, timezone: BRU, ...extra }, db, "2026-09-21");
	return items.filter((i): i is CalendarOccurrence => i.kind === "event");
}

async function tuesdayCall() {
	return create(
		{
			title: "Weekly call",
			startLocal: "2026-09-22T10:00",
			endLocal: "2026-09-22T10:30",
			timezone: BRU,
			rrule: "FREQ=WEEKLY;BYDAY=TU",
		},
		db,
	);
}

describe("create", () => {
	it("stores wall clock, zone and the first occurrence as instants", async () => {
		const made = await tuesdayCall();
		expect(made.startLocal).toBe("2026-09-22T10:00:00");
		expect(made.endLocal).toBe("2026-09-22T10:30:00");
		expect(made.startUtc).toBe("2026-09-22T08:00:00.000Z");
		expect(made.endUtc).toBe("2026-09-22T08:30:00.000Z");
		expect(made.seriesEndUtc).toBeNull();
		expect(made.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
		expect(made.recurrenceLabel).toBe("Every week on Tuesday");
		expect(made.icalUid).toBe(`${made.id}@juno`);
	});

	it("defaults the end to an hour, or a day for all-day, and the zone to the machine's", async () => {
		const timed = await create({ title: "Timed", startLocal: "2026-09-22T09:00:00" }, db);
		expect(timed.endLocal).toBe("2026-09-22T10:00:00");
		expect(timed.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
		const day = await create({ title: "Day", startLocal: "2026-09-22", allDay: true }, db);
		expect(day.endLocal).toBe("2026-09-23");
	});

	it("refuses what it cannot place", async () => {
		await expect(create({ title: "", startLocal: "2026-09-22T09:00" }, db)).rejects.toThrow(/title/);
		await expect(create({ title: "x", startLocal: "2026-09-22" }, db)).rejects.toThrow(/needs a time/);
		await expect(create({ title: "x", startLocal: "2026-09-22T09:00", endLocal: "2026-09-22T08:00" }, db)).rejects.toThrow(/end before/);
		await expect(create({ title: "x", startLocal: "2026-09-22T09:00", timezone: "Mars/Olympus" }, db)).rejects.toThrow(/time zone/);
		await expect(create({ title: "x", startLocal: "2026-09-22T09:00", rrule: "FREQ=HOURLY" }, db)).rejects.toThrow(/daily, weekly/);
		await expect(create({ title: "x", startLocal: "2026-09-22T09:00", clientId: "nope" }, db)).rejects.toThrow(/No client/);
	});

	it("takes the client from the project and refuses a mismatch", async () => {
		const [a] = db.insert(clients).values({ name: "obet", sortName: "obet" }).returning().all();
		const [b] = db.insert(clients).values({ name: "bodhi", sortName: "bodhi" }).returning().all();
		const [p] = db.insert(projects).values({ clientId: a!.id, name: "Site" }).returning().all();
		const made = await create({ title: "Kickoff", startLocal: "2026-09-22T09:00", projectId: p!.id }, db);
		expect(made.clientId).toBe(a!.id);
		expect(made.clientName).toBe("obet");
		expect(made.projectName).toBe("Site");
		await expect(
			create({ title: "x", startLocal: "2026-09-22T09:00", projectId: p!.id, clientId: b!.id }, db),
		).rejects.toThrow(/different client/);
	});
});

describe("listRange", () => {
	it("expands a series across the October DST change at the same wall clock", async () => {
		await tuesdayCall();
		const out = await events("2026-10-19", "2026-11-04");
		expect(out.map((o) => [o.startLocal, o.startUtc])).toEqual([
			["2026-10-20T10:00:00", "2026-10-20T08:00:00.000Z"],
			["2026-10-27T10:00:00", "2026-10-27T09:00:00.000Z"],
			["2026-11-03T10:00:00", "2026-11-03T09:00:00.000Z"],
		]);
		expect(out[0]!.isRecurring).toBe(true);
		expect(out[0]!.occurrenceStartLocal).toBe("2026-10-20T10:00:00");
	});

	it("reads the range in the zone asked for", async () => {
		// 23:30 Brussels on the 22nd is the 22nd in Brussels and the 23rd in Tokyo.
		await create({ title: "Late", startLocal: "2026-09-22T23:30", timezone: BRU }, db);
		expect(await events("2026-09-22", "2026-09-22")).toHaveLength(1);
		const tokyo = await listRange({ from: "2026-09-22", to: "2026-09-22", timezone: "Asia/Tokyo" }, db);
		expect(tokyo).toHaveLength(0);
		const tokyoNext = await listRange({ from: "2026-09-23", to: "2026-09-23", timezone: "Asia/Tokyo" }, db);
		expect(tokyoNext).toHaveLength(1);
	});

	it("skips a series that has ended and a single event outside the range", async () => {
		await create({ title: "Short series", startLocal: "2026-09-01T09:00", rrule: "FREQ=DAILY;COUNT=3", timezone: BRU }, db);
		await create({ title: "One off", startLocal: "2026-08-01T09:00", timezone: BRU }, db);
		expect(await events("2026-09-01", "2026-09-30")).toHaveLength(3);
		expect(await events("2026-09-04", "2026-09-30")).toHaveLength(0);
	});

	it("overlays open reminders and project deadlines, read-only", async () => {
		const [c] = db.insert(clients).values({ name: "obet", sortName: "obet" }).returning().all();
		db.insert(projects).values({ clientId: c!.id, name: "Site", dueOn: "2026-09-25" }).run();
		await reminders.create({ title: "File the VAT return", dueOn: "2026-09-24" }, db, "2026-09-21");
		const done = await reminders.create({ title: "Already done", dueOn: "2026-09-24" }, db, "2026-09-21");
		await reminders.complete(done.id, {}, db, "2026-09-21");

		const items = await listRange(
			{ from: "2026-09-21", to: "2026-09-27", timezone: BRU, includeReminders: true, includeDeadlines: true },
			db,
			"2026-09-21",
		);
		expect(items.map((i) => i.kind)).toEqual(["reminder", "deadline"]);
		const reminder = items[0];
		const deadline = items[1];
		if (reminder?.kind !== "reminder" || deadline?.kind !== "deadline") throw new Error("wrong kinds");
		expect(reminder.title).toBe("File the VAT return");
		expect(reminder.bucket).toBe("soon");
		expect(deadline.projectName).toBe("Site");
		expect(deadline.clientName).toBe("obet");

		const plain = await listRange({ from: "2026-09-21", to: "2026-09-27", timezone: BRU }, db, "2026-09-21");
		expect(plain).toHaveLength(0);
	});

	it("refuses a bad range", async () => {
		await expect(listRange({ from: "2026-09-30", to: "2026-09-01" }, db)).rejects.toThrow(/ends before/);
		await expect(listRange({ from: "2020-01-01", to: "2026-09-01" }, db)).rejects.toThrow(/400 days/);
		await expect(listRange({ from: "today", to: "2026-09-01" }, db)).rejects.toThrow(/calendar dates/);
	});
});

describe("update, scope this", () => {
	it("moves one occurrence and leaves the rest", async () => {
		const made = await tuesdayCall();
		const after = await update(
			made.id,
			{ startLocal: "2026-10-29T14:00", location: "Their office" },
			{ scope: "this", occurrenceStartLocal: "2026-10-27T10:00:00" },
			db,
		);
		expect(after.id).toBe(made.id);
		expect(after.exceptions).toHaveLength(1);
		expect(after.exceptions[0]).toMatchObject({
			occurrenceStartLocal: "2026-10-27T10:00:00",
			cancelled: false,
			startLocal: "2026-10-29T14:00:00",
			endLocal: "2026-10-29T14:30:00",
			location: "Their office",
			title: null,
		});
		const out = await events("2026-10-26", "2026-11-04");
		expect(out.map((o) => [o.startLocal, o.startUtc, o.isException, o.location])).toEqual([
			["2026-10-29T14:00:00", "2026-10-29T13:00:00.000Z", true, "Their office"],
			["2026-11-03T10:00:00", "2026-11-03T09:00:00.000Z", false, null],
		]);
		expect(out[0]!.title).toBe("Weekly call");
	});

	it("needs the occurrence, and it has to be a real one", async () => {
		const made = await tuesdayCall();
		await expect(update(made.id, { title: "x" }, { scope: "this" }, db)).rejects.toThrow(/occurrenceStartLocal/);
		await expect(
			update(made.id, { title: "x" }, { scope: "this", occurrenceStartLocal: "2026-10-28T10:00:00" }, db),
		).rejects.toThrow(/not an occurrence/);
	});

	it("will not change the rule or the zone for one occurrence", async () => {
		const made = await tuesdayCall();
		await expect(
			update(made.id, { rrule: "FREQ=DAILY" }, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db),
		).rejects.toThrow(/whole series/);
	});

	it("stores nothing for a field put back to the master's value", async () => {
		const made = await tuesdayCall();
		await update(made.id, { title: "Special" }, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db);
		const back = await update(made.id, { title: "Weekly call" }, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db);
		expect(back.exceptions[0]!.title).toBeNull();
	});

	it("edits a single event directly whatever the scope says", async () => {
		const made = await create({ title: "One off", startLocal: "2026-09-22T09:00", timezone: BRU }, db);
		const after = await update(made.id, { title: "Renamed" }, { scope: "this" }, db);
		expect(after.title).toBe("Renamed");
		expect(after.exceptions).toHaveLength(0);
	});
});

describe("update, scope all", () => {
	it("moves the series and carries its exceptions along", async () => {
		const made = await tuesdayCall();
		await remove(made.id, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db);
		await update(made.id, { startLocal: "2026-10-08T15:00" }, { scope: "this", occurrenceStartLocal: "2026-10-06T10:00:00" }, db);

		// An hour later, every week.
		const after = await update(made.id, { startLocal: "2026-09-22T11:00", endLocal: "2026-09-22T11:30" }, { scope: "all" }, db);
		expect(after.startLocal).toBe("2026-09-22T11:00:00");
		expect(after.exceptions.map((e) => [e.occurrenceStartLocal, e.cancelled, e.startLocal])).toEqual([
			["2026-09-29T11:00:00", true, null],
			["2026-10-06T11:00:00", false, "2026-10-08T16:00:00"],
		]);
		const out = await events("2026-09-28", "2026-10-12");
		expect(out.map((o) => o.startLocal)).toEqual(["2026-10-08T16:00:00"]);
	});

	it("keeps the length when only the start moves", async () => {
		const made = await tuesdayCall();
		const after = await update(made.id, { startLocal: "2026-09-22T14:00" }, { scope: "all" }, db);
		expect(after.endLocal).toBe("2026-09-22T14:30:00");
	});

	it("drops the exceptions when the series stops repeating", async () => {
		const made = await tuesdayCall();
		await remove(made.id, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db);
		const after = await update(made.id, { rrule: null }, { scope: "all" }, db);
		expect(after.rrule).toBeNull();
		expect(after.exceptions).toHaveLength(0);
		expect(after.seriesEndUtc).toBe(after.endUtc);
	});
});

describe("update, scope following", () => {
	it("splits the series and moves later exceptions to the new one", async () => {
		const made = await tuesdayCall();
		await remove(made.id, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db);
		await remove(made.id, { scope: "this", occurrenceStartLocal: "2026-10-20T10:00:00" }, db);

		const second = await update(
			made.id,
			{ title: "Weekly call, new slot", startLocal: "2026-10-14T16:00" },
			{ scope: "following", occurrenceStartLocal: "2026-10-13T10:00:00" },
			db,
		);
		expect(second.id).not.toBe(made.id);
		expect(second.title).toBe("Weekly call, new slot");
		expect(second.startLocal).toBe("2026-10-14T16:00:00");
		expect(second.endLocal).toBe("2026-10-14T16:30:00");
		// Dragged from a Tuesday to a Wednesday, so Wednesdays from here on.
		expect(second.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
		// The cancelled 20 October moved across and shifted with the new start.
		expect(second.exceptions.map((e) => [e.occurrenceStartLocal, e.cancelled])).toEqual([["2026-10-21T16:00:00", true]]);

		const first = (await get(made.id, db))!;
		expect(first.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261013T095959Z");
		expect(first.seriesEndUtc).toBe("2026-10-13T08:29:59.000Z");
		expect(first.exceptions.map((e) => e.occurrenceStartLocal)).toEqual(["2026-09-29T10:00:00"]);

		const out = await events("2026-09-21", "2026-10-31");
		expect(out.map((o) => [o.title, o.startLocal])).toEqual([
			["Weekly call", "2026-09-22T10:00:00"],
			["Weekly call", "2026-10-06T10:00:00"],
			["Weekly call, new slot", "2026-10-14T16:00:00"],
			["Weekly call, new slot", "2026-10-28T16:00:00"],
		]);
	});

	it("counts a COUNT down across the split", async () => {
		const made = await create(
			{ title: "Ten", startLocal: "2026-09-22T10:00", timezone: BRU, rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=10" },
			db,
		);
		const second = await update(made.id, { title: "Ten, later" }, { scope: "following", occurrenceStartLocal: "2026-10-13T10:00:00" }, db);
		expect(second.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=7");
		expect((await events("2026-09-01", "2026-12-31")).length).toBe(10);
	});

	it("edits the whole series when the occurrence is the first one", async () => {
		const made = await tuesdayCall();
		const after = await update(made.id, { title: "Renamed" }, { scope: "following", occurrenceStartLocal: "2026-09-22T10:00:00" }, db);
		expect(after.id).toBe(made.id);
		expect(after.title).toBe("Renamed");
	});
});

describe("remove", () => {
	it("cancels one occurrence", async () => {
		const made = await tuesdayCall();
		const after = await remove(made.id, { scope: "this", occurrenceStartLocal: "2026-09-29T10:00:00" }, db);
		expect(after.deletedAt).toBeNull();
		expect(after.exceptions).toEqual([expect.objectContaining({ occurrenceStartLocal: "2026-09-29T10:00:00", cancelled: true })]);
		expect((await events("2026-09-21", "2026-10-06")).map((o) => o.startLocal)).toEqual([
			"2026-09-22T10:00:00",
			"2026-10-06T10:00:00",
		]);
	});

	it("ends the series before an occurrence", async () => {
		const made = await tuesdayCall();
		await update(made.id, { title: "x" }, { scope: "this", occurrenceStartLocal: "2026-10-20T10:00:00" }, db);
		const after = await remove(made.id, { scope: "following", occurrenceStartLocal: "2026-10-13T10:00:00" }, db);
		expect(after.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261013T095959Z");
		expect(after.exceptions).toHaveLength(0);
		expect((await events("2026-09-21", "2026-12-31")).map((o) => o.startLocal)).toEqual([
			"2026-09-22T10:00:00",
			"2026-09-29T10:00:00",
			"2026-10-06T10:00:00",
		]);
	});

	it("soft-deletes and restores the whole thing", async () => {
		const made = await tuesdayCall();
		const gone = await remove(made.id, { scope: "all" }, db);
		expect(gone.deletedAt).not.toBeNull();
		expect(await get(made.id, db)).toBeNull();
		expect(await events("2026-09-21", "2026-12-31")).toHaveLength(0);
		const back = await restore(made.id, db);
		expect(back.deletedAt).toBeNull();
		expect((await events("2026-09-21", "2026-09-30")).length).toBe(2);
	});
});

describe("ics", () => {
	it("exports a month and imports it into an empty calendar with the moved occurrence in place", async () => {
		const made = await tuesdayCall();
		await update(made.id, { startLocal: "2026-10-29T14:00" }, { scope: "this", occurrenceStartLocal: "2026-10-27T10:00:00" }, db);
		await remove(made.id, { scope: "this", occurrenceStartLocal: "2026-10-06T10:00:00" }, db);
		await create({ title: "Offsite", startLocal: "2026-10-15", endLocal: "2026-10-17", allDay: true, timezone: BRU }, db);

		const text = await exportIcs({ from: "2026-10-01", to: "2026-10-31", timezone: BRU }, db);
		expect(text).toContain("RECURRENCE-ID;TZID=Europe/Brussels:20261027T100000");
		expect(text).toContain("EXDATE;TZID=Europe/Brussels:20261006T100000");
		expect(text).toContain("DTSTART;VALUE=DATE:20261015");

		const otherConnection = openDatabase(":memory:");
		runMigrations(otherConnection, migrations);
		const other = createDrizzle(otherConnection);
		const result = await importIcs(text, other, "UTC");
		expect(result).toEqual({ created: 2, updated: 0, skipped: 0, warnings: [] });

		const items = await listRange({ from: "2026-10-01", to: "2026-11-05", timezone: BRU }, other, "2026-09-21");
		const occurrences = items.filter((i): i is CalendarOccurrence => i.kind === "event");
		expect(occurrences.map((o) => [o.title, o.startLocal, o.startUtc])).toEqual([
			["Weekly call", "2026-10-13T10:00:00", "2026-10-13T08:00:00.000Z"],
			// An all-day event carries no zone in the file, so it takes the
			// default zone given to the import, which is UTC here.
			["Offsite", "2026-10-15", "2026-10-15T00:00:00.000Z"],
			["Weekly call", "2026-10-20T10:00:00", "2026-10-20T08:00:00.000Z"],
			["Weekly call", "2026-10-29T14:00:00", "2026-10-29T13:00:00.000Z"],
			["Weekly call", "2026-11-03T10:00:00", "2026-11-03T09:00:00.000Z"],
		]);

		// The same file again updates rather than duplicates.
		const again = await importIcs(text, other, "UTC");
		expect(again).toMatchObject({ created: 0, updated: 2 });
		expect((await listRange({ from: "2026-10-01", to: "2026-11-05", timezone: BRU }, other, "2026-09-21")).length).toBe(5);
	});
});
