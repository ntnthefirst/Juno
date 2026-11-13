/**
 * Migration 0032 removes the cancelled outbox state (decision 78). A message
 * that was cancelled had not gone out, so it becomes a draft; every other
 * message keeps its state. It runs against a database that already holds
 * messages in each state, because an empty one proves nothing about a data
 * move. Everything up to 0031 is applied first, the rows are written, and then
 * the rest runs.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const BEFORE = "0031_calendar_subscriptions.sql";
const STAMP = "2026-01-01T00:00:00.000Z";

let folder: string;

/** A migrations folder holding every file up to and including the one before 0032. */
function upToBefore(): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
		if (file > BEFORE) continue;
		copyFileSync(join(MIGRATIONS, file), join(dir, file));
	}
	return dir;
}

type Column = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

/** Writes one row, filling every required column that the caller did not name. */
function insert(connection: ShimDatabase, table: string, values: Record<string, unknown>): void {
	const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as Column[];
	const row: Record<string, unknown> = { ...values };
	for (const column of columns) {
		if (column.name in row || column.notnull === 0 || column.dflt_value !== null) continue;
		if (column.name === "owner_id") row[column.name] = "owner";
		else if (column.name.endsWith("_at")) row[column.name] = STAMP;
		else row[column.name] = column.type.toLowerCase().includes("int") ? 0 : "x";
	}
	const names = Object.keys(row);
	connection
		.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
		.run(...names.map((name) => row[name]));
}

beforeEach(() => {
	folder = upToBefore();
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("migration 0032", () => {
	it("turns cancelled messages into drafts and leaves every other state as it was", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);

		insert(connection, "mail_accounts", { id: "account-1" });
		const states = ["draft", "pending", "queued", "sending", "sent", "failed", "cancelled"];
		for (const state of states) {
			insert(connection, "mail_outbox", {
				id: `message-${state}`,
				account_id: "account-1",
				state,
				message_id: `<${state}@example.test>`,
				subject: `A ${state} message`,
			});
		}
		insert(connection, "mail_outbox", {
			id: "message-cancelled-deleted",
			account_id: "account-1",
			state: "cancelled",
			message_id: "<gone@example.test>",
			deleted_at: STAMP,
		});

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied[0]).toBe("0032_outbox_cancelled_to_draft.sql");

		const rows = connection.prepare("SELECT id, state, subject FROM mail_outbox ORDER BY id").all();
		expect(rows).toEqual([
			{ id: "message-cancelled", state: "draft", subject: "A cancelled message" },
			{ id: "message-cancelled-deleted", state: "draft", subject: "" },
			{ id: "message-draft", state: "draft", subject: "A draft message" },
			{ id: "message-failed", state: "failed", subject: "A failed message" },
			{ id: "message-pending", state: "pending", subject: "A pending message" },
			{ id: "message-queued", state: "queued", subject: "A queued message" },
			{ id: "message-sending", state: "sending", subject: "A sending message" },
			{ id: "message-sent", state: "sent", subject: "A sent message" },
		]);
	});
});
