import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { approve, configureAgentActions, request, resetForTests } from "./agent-actions";
import { list, purgeOldEvents, record, type RecordInput } from "./agent-audit";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
	resetForTests();
});

afterEach(() => {
	vi.useRealTimers();
	resetForTests();
});

/** The instant every test purges as of, fixed rather than read off the clock. */
const NOW = new Date("2026-09-27T09:00:00.000Z");

/** `from` minus `months` calendar months, the same arithmetic the purge uses. */
function monthsBefore(months: number, from: Date = NOW): Date {
	const d = new Date(from);
	d.setUTCMonth(d.getUTCMonth() - months);
	return d;
}

/** Writes one audit row with its clock frozen at `at`, so `createdAt` lands there. */
function writeRowAt(at: Date, overrides: Partial<RecordInput> = {}) {
	vi.useFakeTimers();
	vi.setSystemTime(at);
	const row = record(
		{
			actor: "user",
			toolName: "clients.update",
			args: { id: "c1" },
			summary: "Updated a client",
			result: "ok",
			...overrides,
		},
		db,
	);
	vi.useRealTimers();
	return row!;
}

describe("the audit log purge", () => {
	it("returns 0 when there is nothing old enough to purge", () => {
		expect(purgeOldEvents(db, NOW)).toBe(0);
	});

	it("deletes a row older than six months", async () => {
		writeRowAt(monthsBefore(7));
		expect(purgeOldEvents(db, NOW)).toBe(1);
		expect(await list({}, db)).toHaveLength(0);
	});

	it("keeps a row exactly at the six-month boundary", async () => {
		writeRowAt(monthsBefore(6));
		expect(purgeOldEvents(db, NOW)).toBe(0);
		expect(await list({}, db)).toHaveLength(1);
	});

	it("keeps an old row while the request it belongs to is still open", async () => {
		configureAgentActions(async () => ({}));
		vi.useFakeTimers();
		vi.setSystemTime(monthsBefore(7));
		const action = await request(
			{ toolName: "clients.delete", args: { id: "c1" }, summary: "Delete a client", source: "mcp" },
			db,
		);
		vi.useRealTimers();

		expect(purgeOldEvents(db, NOW)).toBe(0);
		const rows = await list({}, db);
		expect(rows.map((row) => row.actionId)).toContain(action.id);
	});

	it("deletes the same row once the request it belonged to is closed", async () => {
		configureAgentActions(async () => ({}));
		vi.useFakeTimers();
		vi.setSystemTime(monthsBefore(7));
		const action = await request(
			{ toolName: "clients.delete", args: { id: "c1" }, summary: "Delete a client", source: "mcp" },
			db,
		);
		// Both the "pending" row from the request and the "ok" row from
		// approving it were written seven months ago, and the action is now
		// closed, so neither is protected any more.
		await approve(action.id, db);
		vi.useRealTimers();

		expect(purgeOldEvents(db, NOW)).toBe(2);
		expect(await list({}, db)).toHaveLength(0);
	});
});
