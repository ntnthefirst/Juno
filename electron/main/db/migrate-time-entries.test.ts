/**
 * Migration 0024 adds `time_entries`, `project_status_changes` and a nullable
 * `estimated_minutes` on projects, on top of the released 0023. It rebuilds no
 * table, but it runs against a database that already holds projects with
 * children, because an empty database proves nothing about a column added to a
 * table that has rows. Everything up to 0023 is on installed machines, so this
 * applies those files, writes the rows, then applies the rest.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const LAST_RELEASED = "0023_recent_items_mail_blocks_suggestions.sql";
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

describe("migration 0024", () => {
	it("keeps every project and its children, and adds the new tables and column", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		expect(tables(connection)).not.toContain("time_entries");

		insert(connection, "clients", { id: "client-1", name: "Van Damme", sort_name: "van damme" });
		insert(connection, "projects", { id: "project-1", client_id: "client-1", name: "Kitchen cabinets" });
		insert(connection, "projects", { id: "project-2", name: "Own work" });
		insert(connection, "project_links", { id: "link-1", project_id: "project-1", label: "Folder", target: "C:\\x" });

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied[0]).toBe("0024_time_entries_and_project_estimate.sql");

		const names = tables(connection);
		expect(names).toContain("time_entries");
		expect(names).toContain("project_status_changes");

		const projects = connection.prepare("SELECT id, name, estimated_minutes FROM projects ORDER BY id").all() as {
			id: string;
			name: string;
			estimated_minutes: number | null;
		}[];
		expect(projects).toEqual([
			{ id: "project-1", name: "Kitchen cabinets", estimated_minutes: null },
			{ id: "project-2", name: "Own work", estimated_minutes: null },
		]);
		const link = connection.prepare("SELECT COUNT(*) AS n FROM project_links").get() as { n: number };
		expect(link.n).toBe(1);

		connection.prepare("UPDATE projects SET estimated_minutes = 840 WHERE id = 'project-1'").run();
		insert(connection, "time_entries", {
			id: "time-1",
			project_id: "project-1",
			client_id: "client-1",
			started_at: STAMP,
			ended_at: STAMP,
			duration_minutes: 60,
		});
		insert(connection, "project_status_changes", { id: "change-1", project_id: "project-1", changed_at: STAMP });
	});

	it("allows one running timer per owner and no more", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, MIGRATIONS);
		insert(connection, "projects", { id: "project-1", name: "One" });

		insert(connection, "time_entries", { id: "time-1", project_id: "project-1", started_at: STAMP });
		expect(() =>
			insert(connection, "time_entries", { id: "time-2", project_id: "project-1", started_at: STAMP }),
		).toThrow(/UNIQUE/);

		// A finished or deleted row does not count as running.
		connection.prepare("UPDATE time_entries SET ended_at = ?, duration_minutes = 5 WHERE id = 'time-1'").run(STAMP);
		insert(connection, "time_entries", { id: "time-2", project_id: "project-1", started_at: STAMP });
	});
});
