/**
 * Plain Node through Vitest, on an in-memory database built from the committed
 * migrations, so the FTS5 table and its triggers are the real ones.
 */
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clients from "./clients";
import * as notes from "./notes";
import * as pages from "./pages";
import * as documents from "./documents";
import * as projects from "./projects";

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

function later(minutes: number) {
	vi.setSystemTime(new Date(Date.parse("2026-10-02T09:00:00.000Z") + minutes * 60_000));
}

describe("notes", () => {
	it("creates a note with the five columns and reads it back with its owners' names", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Peeters" }, db);
		const project = await projects.create({ name: "Dining table" }, db);
		const note = await notes.create({ title: "Delivery", body: "- [ ] Call", clientId: client.id, projectId: project.id }, db);
		expect(note).toMatchObject({ title: "Delivery", clientName: "Peeters", projectName: "Dining table", pinnedAt: null });
		expect(note.deletedAt).toBeNull();
		expect(note.createdAt).toBe("2026-10-02T09:00:00.000Z");
		expect(await notes.get(note.id, db)).toMatchObject({ id: note.id });
	});

	it("refuses an owner that does not exist", async () => {
		const db = freshDb();
		await expect(notes.create({ title: "x", clientId: "nope" }, db)).rejects.toThrow();
		await expect(notes.create({ title: "x", projectId: "nope" }, db)).rejects.toThrow();
	});

	it("lists the newest edit first and the pinned notes above it", async () => {
		const db = freshDb();
		const a = await notes.create({ title: "A" }, db);
		later(1);
		const b = await notes.create({ title: "B" }, db);
		later(2);
		const c = await notes.create({ title: "C" }, db);
		expect((await notes.list({}, db)).map((n) => n.title)).toEqual(["C", "B", "A"]);

		later(3);
		await notes.update(a.id, { pinned: true }, db);
		expect((await notes.list({}, db)).map((n) => n.title)).toEqual(["A", "C", "B"]);

		later(4);
		await notes.update(b.id, { body: "edited" }, db);
		expect((await notes.list({}, db)).map((n) => n.title)).toEqual(["A", "B", "C"]);

		later(5);
		await notes.update(a.id, { pinned: false }, db);
		expect((await notes.list({}, db))[0]!.id).toBe(a.id);
		expect(c.id).toBeTruthy();
	});

	it("filters by client and project", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Peeters" }, db);
		await notes.create({ title: "Mine" }, db);
		await notes.create({ title: "Theirs", clientId: client.id }, db);
		expect((await notes.list({ clientId: client.id }, db)).map((n) => n.title)).toEqual(["Theirs"]);
	});

	it("finds a note by a word in its title or its text, and follows an edit", async () => {
		const db = freshDb();
		const oak = await notes.create({ title: "Delivery planning", body: "Oak for the Peeters table arrives on Friday" }, db);
		await notes.create({ title: "Prices", body: "Hourly rate and materials" }, db);

		expect((await notes.search("peeters", {}, db)).map((hit) => hit.note.id)).toEqual([oak.id]);
		expect((await notes.search("deliv", {}, db)).map((hit) => hit.note.id)).toEqual([oak.id]);
		expect(await notes.search("   ", {}, db)).toEqual([]);

		await notes.update(oak.id, { body: "Walnut instead" }, db);
		expect(await notes.search("peeters", {}, db)).toEqual([]);
		expect((await notes.search("walnut", {}, db))[0]!.snippet).toContain("Walnut");
	});

	it("keeps a deleted note out of lists and search, and brings it back on restore", async () => {
		const db = freshDb();
		const note = await notes.create({ title: "Gone", body: "findable" }, db);
		await notes.remove(note.id, db);
		expect(await notes.list({}, db)).toEqual([]);
		expect(await notes.get(note.id, db)).toBeNull();
		expect(await notes.search("findable", {}, db)).toEqual([]);
		await expect(notes.remove(note.id, db)).rejects.toThrow(/may already be deleted/);

		await notes.restore(note.id, db);
		expect((await notes.search("findable", {}, db)).map((hit) => hit.note.id)).toEqual([note.id]);
		await expect(notes.restore(note.id, db)).rejects.toThrow();
	});

	it("duplicates a note unpinned and titled as a copy", async () => {
		const db = freshDb();
		const note = await notes.create({ title: "Prices", body: "Hourly" }, db);
		await notes.update(note.id, { pinned: true }, db);
		const copy = await notes.duplicate(note.id, db);
		expect(copy).toMatchObject({ title: "Prices (copy)", body: "Hourly", pinnedAt: null });
		expect(copy.id).not.toBe(note.id);
	});
});

describe("pages", () => {
	it("is a document of kind page, listed with documents and owned like one", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Peeters" }, db);
		const page = await pages.create({ title: "Oak dining table, quote", clientId: client.id }, db);
		expect(page.document).toMatchObject({ sourceKind: "page", clientName: "Peeters", pdfPath: null });
		expect(page.blocks).toHaveLength(1);

		const listed = await documents.list({ clientId: client.id }, db);
		expect(listed.map((d) => d.id)).toEqual([page.document.id]);
	});

	it("saves blocks, compiles the body and drops what is not a block", async () => {
		const db = freshDb();
		const page = await pages.create({}, db);
		const saved = await pages.update(
			page.document.id,
			{
				title: "Quote",
				blocks: [
					{ id: "h", type: "heading", text: "The job" },
					{ id: "t", type: "text", text: "<b>Solid</b> oak<script>1</script>" },
					{ id: "c", type: "check", text: "Order", done: true },
					{ type: "junk" },
				],
			},
			db,
		);
		expect(saved.document.title).toBe("Quote");
		expect(saved.blocks.map((b) => b.id)).toEqual(["h", "t", "c"]);
		expect(saved.document.bodyHtml).toContain("<h2>The job</h2>");
		expect(saved.document.bodyHtml).toContain("<p><b>Solid</b> oak1</p>");
		await expect(pages.update(page.document.id, { blocks: "x" }, db)).rejects.toThrow();
	});

	it("moves between a client and a project with the document rule", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Peeters" }, db);
		const project = await projects.create({ name: "Table", clientId: client.id }, db);
		const page = await pages.create({}, db);
		const moved = await pages.update(page.document.id, { projectId: project.id }, db);
		expect(moved.document).toMatchObject({ projectId: project.id, clientId: client.id });
		const cleared = await pages.update(page.document.id, { clientId: null, projectId: null }, db);
		expect(cleared.document).toMatchObject({ projectId: null, clientId: null });
	});

	it("refuses to read a document that is not a page as one", async () => {
		const db = freshDb();
		await expect(pages.get("nope", db)).rejects.toThrow(/No page/);
	});
});
