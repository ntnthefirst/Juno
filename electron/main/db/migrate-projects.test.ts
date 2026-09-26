/**
 * Migration 0012 rebuilds the projects table, which is the one shape of
 * migration that can destroy data.
 *
 * Running the whole folder against an empty database proves nothing about it: a
 * rebuild only has anything to carry when there are rows, and the foreign keys
 * that point at `projects` from documents, reminders and calendar_events only
 * bite when a child row exists. So this applies everything up to 0011, writes
 * the rows that make the rebuild hard, and only then applies 0012.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const REBUILD = "0012_project_workspace.sql";

let folder: string;

/** A migrations folder holding every file before the rebuild. */
function upTo(cut: string): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
		if (file >= cut) continue;
		copyFileSync(join(MIGRATIONS, file), join(dir, file));
	}
	return dir;
}

function seedOldShape(connection: ShimDatabase): void {
	const stamp = "2026-01-01T00:00:00.000Z";
	connection
		.prepare(
			"INSERT INTO clients (id, owner_id, created_at, updated_at, name, sort_name) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run("client-1", "owner", stamp, stamp, "De Backer BV", "de backer bv");
	connection
		.prepare(
			"INSERT INTO projects (id, owner_id, created_at, updated_at, client_id, name, due_on, agreed_value_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run("project-1", "owner", stamp, stamp, "client-1", "Website", "2026-11-14", 210000);
	// The child row that makes the drop interesting: with foreign keys on, the
	// implicit delete inside DROP TABLE would refuse while this points at it.
	connection
		.prepare(
			"INSERT INTO documents (id, owner_id, created_at, updated_at, client_id, project_id, title, body_html) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run("document-1", "owner", stamp, stamp, "client-1", "project-1", "Overeenkomst", "<p>x</p>");
}

beforeEach(() => {
	folder = upTo(REBUILD);
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("the projects rebuild in migration 0012", () => {
	it("carries the rows and the rows that point at them", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		seedOldShape(connection);

		const result = runMigrations(connection, MIGRATIONS);
		// The rebuild runs first, and whatever was generated after it runs after
		// it. Pinning the whole list instead would make this test fail on every
		// later migration while saying nothing about the rebuild.
		expect(result.applied[0]).toBe(REBUILD);

		const project = connection
			.prepare("SELECT * FROM projects WHERE id = ?")
			.get("project-1") as Record<string, unknown>;
		expect(project.name).toBe("Website");
		expect(project.client_id).toBe("client-1");
		expect(project.agreed_value_cents).toBe(210000);
		// The four new columns take their defaults rather than arriving null.
		expect(project.storage_mode).toBe("app");
		expect(project.local_path).toBeNull();
		expect(project.storage_path).toBeNull();
		expect(project.cover_asset_id).toBeNull();

		// The document still points at it, and the key still resolves.
		const document = connection
			.prepare("SELECT project_id FROM documents WHERE id = ?")
			.get("document-1") as { project_id: string };
		expect(document.project_id).toBe("project-1");
		expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	});

	it("leaves client_id nullable afterwards", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		seedOldShape(connection);
		runMigrations(connection, MIGRATIONS);

		connection
			.prepare(
				"INSERT INTO projects (id, owner_id, created_at, updated_at, name, storage_mode) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run("project-2", "owner", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "Juno", "app");

		const rows = connection
			.prepare("SELECT id FROM projects WHERE client_id IS NULL")
			.all() as { id: string }[];
		expect(rows.map((row) => row.id)).toEqual(["project-2"]);
	});
});
