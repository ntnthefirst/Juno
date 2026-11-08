/**
 * Migration 0029 adds a nullable `due_time` to reminders. It rebuilds nothing,
 * but it runs against a database that already holds reminders, with a client,
 * a project, a completion and a deleted one, because an empty database proves
 * nothing about a column added to a table with rows. Everything up to 0028 is
 * applied first, the rows are written, and then the rest runs.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const BEFORE = "0028_client_language.sql";
const STAMP = "2026-01-01T00:00:00.000Z";

let folder: string;

/** A migrations folder holding every file up to and including the one before 0029. */
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

function columnsOf(connection: ShimDatabase, table: string): string[] {
	return (connection.prepare(`PRAGMA table_info(${table})`).all() as Column[]).map((column) => column.name);
}

beforeEach(() => {
	folder = upToBefore();
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("migration 0029", () => {
	it("keeps every reminder as it was and gives each an empty due time", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		expect(columnsOf(connection, "reminders")).not.toContain("due_time");

		insert(connection, "clients", { id: "client-1", name: "Peeters", sort_name: "peeters" });
		insert(connection, "projects", { id: "project-1", client_id: "client-1", name: "Kitchen cabinets" });
		insert(connection, "reminders", {
			id: "reminder-1",
			title: "Send the revised quote",
			due_on: "2026-10-13",
			client_id: "client-1",
			project_id: "project-1",
			is_system: 0,
			sort_order: 0,
		});
		insert(connection, "reminders", {
			id: "reminder-2",
			title: "Quarterly VAT",
			due_on: "2026-12-31",
			pattern: "quarter_end",
			is_system: 0,
			sort_order: 1,
			deleted_at: STAMP,
		});
		insert(connection, "reminder_completions", {
			id: "completion-1",
			reminder_id: "reminder-1",
			due_on: "2026-10-13",
			completed_at: STAMP,
		});

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied[0]).toBe("0029_reminder_due_time.sql");

		const rows = connection
			.prepare("SELECT id, title, due_on, due_time, client_id, project_id, deleted_at FROM reminders ORDER BY id")
			.all();
		expect(rows).toEqual([
			{
				id: "reminder-1",
				title: "Send the revised quote",
				due_on: "2026-10-13",
				due_time: null,
				client_id: "client-1",
				project_id: "project-1",
				deleted_at: null,
			},
			{
				id: "reminder-2",
				title: "Quarterly VAT",
				due_on: "2026-12-31",
				due_time: null,
				client_id: null,
				project_id: null,
				deleted_at: STAMP,
			},
		]);
		const completions = connection.prepare("SELECT COUNT(*) AS n FROM reminder_completions").get() as { n: number };
		expect(completions.n).toBe(1);

		connection.prepare("UPDATE reminders SET due_time = '10:00' WHERE id = 'reminder-1'").run();
		const updated = connection.prepare("SELECT due_time FROM reminders WHERE id = 'reminder-1'").get() as {
			due_time: string;
		};
		expect(updated.due_time).toBe("10:00");
	});
});
