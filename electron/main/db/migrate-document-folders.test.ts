/**
 * Migration 0033 makes any file a document (decision 75): versions gain a
 * media type and a size, documents a folder, and two tables arrive. Every
 * version kept before it is a PDF, so its media type is filled in as one. It
 * runs against a database that already holds a document with versions,
 * because an empty one proves nothing about the fill.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const BEFORE = "0032_outbox_cancelled_to_draft.sql";
const STAMP = "2026-01-01T00:00:00.000Z";

let folder: string;

function upToBefore(): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
		if (file > BEFORE) continue;
		copyFileSync(join(MIGRATIONS, file), join(dir, file));
	}
	return dir;
}

function insert(connection: ShimDatabase, table: string, values: Record<string, unknown>): void {
	const row = { owner_id: "owner", created_at: STAMP, updated_at: STAMP, ...values };
	const names = Object.keys(row);
	connection
		.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
		.run(...names.map((name) => row[name as keyof typeof row]));
}

beforeEach(() => {
	folder = upToBefore();
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("migration 0033", () => {
	it("records every earlier version as a PDF and leaves documents in no folder", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);

		insert(connection, "documents", { id: "doc-1", title: "Contract", body_html: "", source_kind: "imported" });
		for (const [id, kind] of [
			["version-1", "imported"],
			["version-2", "stamped"],
		]) {
			insert(connection, "document_versions", {
				id,
				document_id: "doc-1",
				kind,
				source: "drop",
				pdf_path: `C:/docs/${id}.pdf`,
				file_date: STAMP,
			});
		}

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied).toContain("0033_document_folders_and_any_file.sql");

		expect(connection.prepare("SELECT id, media_type, byte_size FROM document_versions ORDER BY id").all()).toEqual([
			{ id: "version-1", media_type: "application/pdf", byte_size: null },
			{ id: "version-2", media_type: "application/pdf", byte_size: null },
		]);
		expect(connection.prepare("SELECT folder_id FROM documents").all()).toEqual([{ folder_id: null }]);
		expect(connection.prepare("SELECT count(*) AS n FROM document_folders").get()).toEqual({ n: 0 });
		expect(connection.prepare("SELECT count(*) AS n FROM document_working_copies").get()).toEqual({ n: 0 });
	});
});
