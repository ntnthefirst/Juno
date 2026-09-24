/**
 * The client timeline: notes written by hand, and the merge of everything that
 * already had a record of its own.
 *
 * The case worth holding is the date-only one. A reminder and a deadline are
 * stored as YYYY-MM-DD, and a timeline that turned those into instants and back
 * would move half of them by a day for half the year. `on` exists so the
 * interface never has to.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as timeline from "./client-timeline";
import * as clients from "./clients";
import * as projects from "./projects";
import * as reminders from "./reminders";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

async function withClient(): Promise<{ db: Db; clientId: string }> {
	const db = freshDb();
	const client = await clients.create({ name: "Jansen BV" }, db);
	return { db, clientId: client.id };
}

describe("notes", () => {
	it("dates a note when it happened, not when it was written", async () => {
		const { db, clientId } = await withClient();

		const note = await timeline.createNote(
			{ clientId, title: "Called about the roof", kind: "call", happenedAt: "2026-03-10T09:00:00.000Z" },
			db,
		);

		expect(note.happenedAt).toBe("2026-03-10T09:00:00.000Z");
		// Written now, which is a different thing and is kept separately.
		expect(note.createdAt).not.toBe(note.happenedAt);
	});

	it("refuses a note with nothing in its line", async () => {
		const { db, clientId } = await withClient();
		await expect(timeline.createNote({ clientId, title: "   " }, db)).rejects.toThrow(/what happened/i);
	});

	it("refuses a kind it does not have an icon for", async () => {
		const { db, clientId } = await withClient();
		await expect(
			// The renderer offers three; an agent can send anything.
			timeline.createNote({ clientId, title: "x", kind: "carrier pigeon" as never }, db),
		).rejects.toThrow(/note, call, meeting/);
	});

	it("refuses a note on a client that is not there", async () => {
		const { db } = await withClient();
		await expect(timeline.createNote({ clientId: "nope", title: "x" }, db)).rejects.toThrow(
			/does not exist/i,
		);
	});

	it("takes a note out of the timeline when it is removed, and puts it back", async () => {
		const { db, clientId } = await withClient();
		const note = await timeline.createNote({ clientId, title: "Called about the roof" }, db);

		await timeline.removeNote(note.id, db);
		expect(await timeline.timeline({ clientId }, db)).toHaveLength(0);

		await timeline.restoreNote(note.id, db);
		expect(await timeline.timeline({ clientId }, db)).toHaveLength(1);
	});
});

describe("the merged stream", () => {
	it("puts every source in one list, newest first", async () => {
		const { db, clientId } = await withClient();
		await timeline.createNote(
			{ clientId, title: "Called about the roof", happenedAt: "2026-03-10T09:00:00.000Z" },
			db,
		);
		await projects.create({ clientId, name: "Roof", startsOn: "2026-03-12" }, db);
		await reminders.create({ title: "Send the quote", dueOn: "2026-03-20", clientId }, db);

		const entries = await timeline.timeline({ clientId }, db);

		expect(entries.map((entry) => entry.kind)).toEqual(["reminder", "project", "note"]);
		expect(entries.map((entry) => entry.title)).toEqual([
			"Send the quote",
			"Roof",
			"Called about the roof",
		]);
	});

	it("keeps a date-only record as a date and never as an instant to convert", async () => {
		const { db, clientId } = await withClient();
		await reminders.create({ title: "Send the quote", dueOn: "2026-03-20", clientId }, db);

		const [entry] = await timeline.timeline({ clientId }, db);

		expect(entry?.on).toBe("2026-03-20");
		// `at` exists to sort on and is deliberately the same day in UTC. The
		// interface is expected to print `on` and leave `at` alone.
		expect(entry?.at.startsWith("2026-03-20")).toBe(true);
	});

	it("leaves `on` null for something that happened at a time", async () => {
		const { db, clientId } = await withClient();
		await timeline.createNote(
			{ clientId, title: "Called about the roof", happenedAt: "2026-03-10T09:00:00.000Z" },
			db,
		);

		const [entry] = await timeline.timeline({ clientId }, db);

		expect(entry?.on).toBeNull();
		expect(entry?.at).toBe("2026-03-10T09:00:00.000Z");
	});

	it("narrows to the kinds asked for", async () => {
		const { db, clientId } = await withClient();
		await timeline.createNote({ clientId, title: "Called" }, db);
		await projects.create({ clientId, name: "Roof" }, db);

		const entries = await timeline.timeline({ clientId, kinds: ["project"] }, db);

		expect(entries).toHaveLength(1);
		expect(entries[0]?.kind).toBe("project");
	});

	it("gives each entry an id that cannot collide with another source", async () => {
		const { db, clientId } = await withClient();
		await timeline.createNote({ clientId, title: "Called" }, db);
		await projects.create({ clientId, name: "Roof" }, db);

		const entries = await timeline.timeline({ clientId }, db);
		const ids = entries.map((entry) => entry.id);

		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => /^(note|mail|document|event|reminder|project):/.test(id))).toBe(true);
	});

	it("counts each kind for the tabs", async () => {
		const { db, clientId } = await withClient();
		await timeline.createNote({ clientId, title: "Called" }, db);
		await projects.create({ clientId, name: "Roof" }, db);
		await projects.create({ clientId, name: "Gutters" }, db);

		const counts = await timeline.timelineCounts(clientId, db);

		expect(counts.note).toBe(1);
		expect(counts.project).toBe(2);
		expect(counts.mail).toBe(0);
	});
});
