/**
 * Plain Node through Vitest: no service under test may import `electron`. Each
 * test gets its own in-memory database built from the committed migrations.
 */
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { referenceSets } from "../db/schema";
import * as clients from "./clients";
import * as timeline from "./project-timeline";
import * as projects from "./projects";
import * as time from "./time-entries";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-02T09:00:00.000Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("the timer", () => {
	it("starts, runs and stops into whole minutes", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Kitchen cabinets" }, db);

		const started = await time.start(project.id, "Assembly", db);
		expect(started.endedAt).toBeNull();
		expect(started.durationMinutes).toBeNull();
		expect(time.running(db)?.projectName).toBe("Kitchen cabinets");

		vi.setSystemTime(new Date("2026-10-02T11:30:20.000Z"));
		const stopped = await time.stop(undefined, db);
		expect(stopped.id).toBe(started.id);
		expect(stopped.durationMinutes).toBe(150);
		expect(stopped.endedAt).toBe("2026-10-02T11:30:20.000Z");
		expect(stopped.note).toBe("Assembly");
		expect(time.running(db)).toBeNull();
	});

	it("refuses a second timer while one runs, and says which", async () => {
		const db = freshDb();
		const first = await projects.create({ name: "First" }, db);
		const second = await projects.create({ name: "Second" }, db);

		await time.start(first.id, null, db);
		await expect(time.start(second.id, null, db)).rejects.toThrow(/already running on "First"/);
		await expect(time.start(first.id, null, db)).rejects.toThrow(/already running/);

		await time.stop(undefined, db);
		await expect(time.start(second.id, null, db)).resolves.toMatchObject({ projectId: second.id });
	});

	it("records at least a minute, and refuses to stop nothing", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Quick" }, db);
		await expect(time.stop(undefined, db)).rejects.toThrow(/No timer is running/);

		await time.start(project.id, null, db);
		vi.setSystemTime(new Date("2026-10-02T09:00:10.000Z"));
		expect((await time.stop(undefined, db)).durationMinutes).toBe(1);
	});

	it("lets the database refuse a second running row even past the service", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Race" }, db);
		await time.start(project.id, null, db);
		const { timeEntries } = await import("../db/schema");
		expect(() =>
			db.insert(timeEntries).values({ projectId: project.id, startedAt: "2026-10-02T09:00:00.000Z" }).run(),
		).toThrow(/UNIQUE/);
	});

	it("tells a listener when the timer starts and stops", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Watched" }, db);
		const seen: (string | null)[] = [];
		const off = time.onTimerChange((running) => seen.push(running?.projectName ?? null));
		await time.start(project.id, null, db);
		await time.stop(undefined, db);
		off();
		expect(seen).toEqual(["Watched", null]);
	});
});

describe("entries and totals", () => {
	it("adds a manual entry, lists newest first and totals the finished ones", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Van Damme" }, db);
		const project = await projects.create({ name: "Kitchen", clientId: client.id, estimatedMinutes: 840 }, db);

		const a = await time.create({ projectId: project.id, durationMinutes: 60, startedAt: "2026-09-12T09:00:00.000Z", note: "Measurements" }, db);
		await time.create({ projectId: project.id, durationMinutes: 240, startedAt: "2026-09-24T09:00:00.000Z" }, db);
		expect(a.clientId).toBe(client.id);
		expect(a.endedAt).toBe("2026-09-12T10:00:00.000Z");

		await time.start(project.id, "Running", db);

		const listed = await time.list(project.id, db);
		expect(listed).toHaveLength(3);
		expect(listed[0]!.note).toBe("Running");

		// A running timer has no duration yet, so it is not in the figure.
		expect(await time.total(project.id, db)).toEqual({ loggedMinutes: 300, estimatedMinutes: 840, entryCount: 2 });
	});

	it("rejects durations that are not whole minutes", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Strict" }, db);
		await expect(time.create({ projectId: project.id, durationMinutes: 1.5 }, db)).rejects.toThrow(/whole number/);
		await expect(time.create({ projectId: project.id, durationMinutes: 0 }, db)).rejects.toThrow(/at least one/);
		await expect(
			time.create({ projectId: project.id, durationMinutes: 30, startedAt: "yesterday" }, db),
		).rejects.toThrow(/UTC time/);
	});

	it("updates a finished entry, soft deletes it, and leaves a running one's time alone", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Edits" }, db);
		const entry = await time.create({ projectId: project.id, durationMinutes: 30 }, db);

		const changed = await time.update(entry.id, { durationMinutes: 45, note: "  Oiling " }, db);
		expect(changed.durationMinutes).toBe(45);
		expect(changed.note).toBe("Oiling");

		const live = await time.start(project.id, null, db);
		await expect(time.update(live.id, { durationMinutes: 5 }, db)).rejects.toThrow(/still running/);
		await expect(time.update(live.id, { note: "Fine" }, db)).resolves.toMatchObject({ note: "Fine" });

		await time.remove(entry.id, db);
		expect((await time.list(project.id, db)).map((row) => row.id)).toEqual([live.id]);
		await time.remove(live.id, db);
		expect(time.running(db)).toBeNull();
	});

	it("keeps the estimate whole, and writes down a status change for the timeline", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Estimated" }, db);
		await expect(projects.update(project.id, { estimatedMinutes: 1.5 }, db)).rejects.toThrow(/whole number/);
		expect((await projects.update(project.id, { estimatedMinutes: 90 }, db)).estimatedMinutes).toBe(90);
	});
});

describe("a project's timeline", () => {
	it("reads the creation, an archive and the time entries back, newest first", async () => {
		const db = freshDb();
		db.insert(referenceSets).values({ key: "project_status", label: "Project status" }).run();
		const project = await projects.create({ name: "History" }, db);
		await time.create({ projectId: project.id, durationMinutes: 240, startedAt: "2026-10-02T09:00:00.000Z", note: "assembly" }, db);

		vi.setSystemTime(new Date("2026-10-03T09:00:00.000Z"));
		await projects.archive(project.id, db);
		// Archiving twice finds the same status rather than adding a second one.
		await projects.archive(project.id, db);

		const entries = await timeline.timeline({ projectId: project.id }, db);
		expect(entries.map((entry) => entry.title)).toEqual([
			"Status set to Archived",
			"Time entry: 4 h assembly",
			"Project created",
		]);

		const onlyTime = await timeline.timeline({ projectId: project.id, kinds: ["time"] }, db);
		expect(onlyTime).toHaveLength(1);
	});
});
