/**
 * Migration 0023 adds three tables on top of the released 0022. Everything
 * before it is on installed machines, so this applies the released files,
 * writes rows into the tables that exist there, then applies the rest and
 * checks that the rows are still there and the new tables work.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const LAST_RELEASED = "0022_link_mail_to_projects.sql";
const STAMP = "2026-01-01T00:00:00.000Z";

let folder: string;

/** A migrations folder holding every file up to and including the last released one. */
function releasedOnly(): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
		if (file > LAST_RELEASED) continue;
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

function tables(connection: ShimDatabase): string[] {
	return (connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
		(row) => row.name,
	);
}

beforeEach(() => {
	folder = releasedOnly();
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("the migrations after the last release", () => {
	it("add their tables without touching what was already stored", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		for (const name of ["recent_items", "mail_blocks", "mail_suggestion_states"]) {
			expect(tables(connection)).not.toContain(name);
		}

		insert(connection, "clients", { id: "client-1", name: "De Backer BV", sort_name: "de backer bv" });
		insert(connection, "projects", { id: "project-1", client_id: "client-1", name: "Website" });
		insert(connection, "mail_accounts", { id: "account-1" });
		insert(connection, "mail_folders", { id: "folder-1", account_id: "account-1" });
		insert(connection, "mail_threads", { id: "thread-1", account_id: "account-1", project_id: "project-1" });
		insert(connection, "mail_messages", {
			id: "message-1",
			account_id: "account-1",
			folder_id: "folder-1",
			thread_id: "thread-1",
		});

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied[0]).toBe("0023_recent_items_mail_blocks_suggestions.sql");

		for (const name of ["recent_items", "mail_blocks", "mail_suggestion_states"]) {
			expect(tables(connection)).toContain(name);
		}
		const thread = connection.prepare("SELECT project_id FROM mail_threads WHERE id = ?").get("thread-1") as {
			project_id: string;
		};
		expect(thread.project_id).toBe("project-1");
		const project = connection.prepare("SELECT name FROM projects WHERE id = ?").get("project-1") as { name: string };
		expect(project.name).toBe("Website");

		insert(connection, "recent_items", { id: "recent-1", kind: "client", record_id: "client-1" });
		insert(connection, "mail_blocks", { id: "block-1", kind: "intro", name: "Formal", body: "Beste" });
		insert(connection, "mail_suggestion_states", {
			id: "state-1",
			message_id: "message-1",
			kind: "event",
			state: "dismissed",
		});
		for (const name of ["recent_items", "mail_blocks", "mail_suggestion_states"]) {
			const count = connection.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number };
			expect(count.n).toBe(1);
		}
	});
});
