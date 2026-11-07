import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clients from "./clients";
import * as projects from "./projects";
import * as recent from "./recent";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	vi.useRealTimers();
});

describe("recent records", () => {
	it("lists the newest first and moves a record to the front when it is opened again", async () => {
		const a = await clients.create({ name: "Peeters" }, db);
		const b = await clients.create({ name: "Janssens" }, db);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-01T09:00:00.000Z"));
		recent.touch("client", a.id, db);
		vi.setSystemTime(new Date("2026-10-01T09:01:00.000Z"));
		recent.touch("client", b.id, db);
		expect(recent.list(db).map((item) => item.name)).toEqual(["Janssens", "Peeters"]);

		vi.setSystemTime(new Date("2026-10-01T09:02:00.000Z"));
		recent.touch("client", a.id, db);
		expect(recent.list(db).map((item) => item.name)).toEqual(["Peeters", "Janssens"]);
	});

	it("names the client a project belongs to", async () => {
		const client = await clients.create({ name: "Peeters" }, db);
		const project = await projects.create({ name: "Oak table", clientId: client.id }, db);
		recent.touch("project", project.id, db);
		expect(recent.list(db)[0]).toMatchObject({ kind: "project", name: "Oak table", context: "Peeters" });
	});

	it("keeps only the newest twenty", async () => {
		vi.useFakeTimers();
		for (let i = 0; i < 25; i += 1) {
			vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 9, i)));
			const client = await clients.create({ name: `Client ${i}` }, db);
			recent.touch("client", client.id, db);
		}
		const items = recent.list(db);
		expect(items).toHaveLength(recent.RECENT_LIMIT);
		expect(items[0]?.name).toBe("Client 24");
		expect(items[19]?.name).toBe("Client 5");
	});

	it("leaves out a record that was deleted", async () => {
		const client = await clients.create({ name: "Peeters" }, db);
		recent.touch("client", client.id, db);
		await clients.remove(client.id, db);
		expect(recent.list(db)).toEqual([]);
	});

	it("clears the list, and an opened record returns afterwards", async () => {
		const client = await clients.create({ name: "Peeters" }, db);
		recent.touch("client", client.id, db);
		recent.clear(db);
		expect(recent.list(db)).toEqual([]);
		recent.touch("client", client.id, db);
		expect(recent.list(db)).toHaveLength(1);
	});

	it("refuses a kind it does not keep", () => {
		expect(() => recent.touch("event" as never, "x", db)).toThrow(/not something Juno keeps/);
	});
});
