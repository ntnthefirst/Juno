/**
 * Migration 0020 rebuilds the documents table so its client can be null, and a
 * rebuild is the one shape of migration that can destroy data.
 *
 * So this applies everything before it, writes the rows that make the rebuild
 * hard (a version, a reminder and a soft-deleted document, each pointing at
 * the table being dropped), and only then applies 0020. See
 * migrate-projects.test.ts for the same check on the projects rebuild.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const REBUILD = "0020_document_client_optional.sql";
const STAMP = "2026-01-01T00:00:00.000Z";

let folder: string;

function upTo(cut: string): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
		if (file >= cut) continue;
		copyFileSync(join(MIGRATIONS, file), join(dir, file));
	}
	return dir;
}

function seedOldShape(connection: ShimDatabase): void {
	connection
		.prepare("INSERT INTO clients (id, owner_id, created_at, updated_at, name, sort_name) VALUES (?, ?, ?, ?, ?, ?)")
		.run("client-1", "owner", STAMP, STAMP, "De Backer BV", "de backer bv");
	connection
		.prepare("INSERT INTO projects (id, owner_id, created_at, updated_at, client_id, name) VALUES (?, ?, ?, ?, ?, ?)")
		.run("project-1", "owner", STAMP, STAMP, "client-1", "Website");
	const document = connection.prepare(
		"INSERT INTO documents (id, owner_id, created_at, updated_at, deleted_at, client_id, project_id, title, body_html, pdf_path, is_specimen, source_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);
	document.run("document-1", "owner", STAMP, STAMP, null, "client-1", "project-1", "Overeenkomst", "<p>x</p>", "a.pdf", 0, "imported");
	document.run("document-2", "owner", STAMP, STAMP, STAMP, "client-1", null, "Weg", "<p>y</p>", null, 1, "generated");
	connection
		.prepare(
			"INSERT INTO document_versions (id, owner_id, created_at, updated_at, document_id, kind, source, pdf_path, file_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run("version-1", "owner", STAMP, STAMP, "document-1", "original", "import", "a.pdf", STAMP);
	connection
		.prepare("INSERT INTO reminders (id, owner_id, created_at, updated_at, title, due_on, document_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.run("reminder-1", "owner", STAMP, STAMP, "Opvolgen", "2026-02-01", "document-1");
}

beforeEach(() => {
	folder = upTo(REBUILD);
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("the documents rebuild in migration 0020", () => {
	it("carries every row, soft-deleted ones included, and the rows that point at them", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		seedOldShape(connection);

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied[0]).toBe(REBUILD);

		const rows = connection.prepare("SELECT * FROM documents ORDER BY id").all() as Record<string, unknown>[];
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			client_id: "client-1",
			project_id: "project-1",
			title: "Overeenkomst",
			pdf_path: "a.pdf",
			is_specimen: 0,
			source_kind: "imported",
		});
		expect(rows[1]).toMatchObject({ deleted_at: STAMP, is_specimen: 1 });

		const version = connection.prepare("SELECT document_id FROM document_versions").get() as { document_id: string };
		expect(version.document_id).toBe("document-1");
		const reminder = connection.prepare("SELECT document_id FROM reminders").get() as { document_id: string };
		expect(reminder.document_id).toBe("document-1");
		expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	});

	it("takes a document with no client afterwards", () => {
		const connection = openDatabase(":memory:");
		runMigrations(connection, MIGRATIONS);
		connection
			.prepare("INSERT INTO documents (id, owner_id, created_at, updated_at, title, body_html) VALUES (?, ?, ?, ?, ?, ?)")
			.run("document-3", "owner", STAMP, STAMP, "Los", "<p>z</p>");
		const row = connection.prepare("SELECT client_id FROM documents WHERE id = ?").get("document-3") as { client_id: null };
		expect(row.client_id).toBeNull();
	});
});
