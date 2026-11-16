/**
 * Migration 0035 takes every document out of the folder it was in (decision
 * 81) and keeps it under that folder's client and project, soft deleting the
 * folders. It runs against a database that already holds folders of a client,
 * of a project, of a project with no client and of Unfiled, nested ones, a
 * deleted one, and documents in each and in none, because an empty database
 * proves nothing about a data move.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const BEFORE = "0034_mail_seen_pending.sql";
const UNDER_TEST = "0035_documents_out_of_folders.sql";
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

function document(connection: ShimDatabase, id: string, place: { client?: string; project?: string; folder?: string }, extra: Record<string, unknown> = {}) {
	insert(connection, "documents", {
		id,
		title: id,
		body_html: "",
		source_kind: "imported",
		client_id: place.client ?? null,
		project_id: place.project ?? null,
		folder_id: place.folder ?? null,
		...extra,
	});
}

beforeEach(() => {
	folder = upToBefore();
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("migration 0035", () => {
	it("keeps every document under its folder's client and project, and soft deletes the folders", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);

		insert(connection, "clients", { id: "acme", name: "Acme", sort_name: "acme" });
		insert(connection, "clients", { id: "noord", name: "Brouwerij Noord", sort_name: "brouwerij noord" });
		insert(connection, "projects", { id: "site", name: "Website", client_id: "acme" });
		insert(connection, "projects", { id: "own", name: "Eigen werk", client_id: null });

		insert(connection, "document_folders", { id: "f-client", name: "Offertes", client_id: "acme", project_id: null });
		insert(connection, "document_folders", { id: "f-nested", name: "2026", parent_id: "f-client", client_id: "acme", project_id: null });
		insert(connection, "document_folders", { id: "f-project", name: "Ontwerpen", client_id: "acme", project_id: "site" });
		insert(connection, "document_folders", { id: "f-own", name: "Schetsen", client_id: null, project_id: "own" });
		insert(connection, "document_folders", { id: "f-unfiled", name: "Losse papieren", client_id: null, project_id: null });
		insert(connection, "document_folders", { id: "f-gone", name: "Oud", client_id: "noord", project_id: null, deleted_at: STAMP });

		document(connection, "in-client-folder", { client: "acme", folder: "f-client" });
		document(connection, "in-nested-folder", { client: "acme", folder: "f-nested" });
		// A project's folder decides the project and brings the project's client, whatever the row said.
		document(connection, "in-project-folder", { folder: "f-project" });
		document(connection, "in-own-folder", { folder: "f-own" });
		document(connection, "in-unfiled-folder", { folder: "f-unfiled" });
		document(connection, "in-deleted-folder", { folder: "f-gone" }, { deleted_at: STAMP });
		document(connection, "in-no-folder", { client: "noord" });
		document(connection, "unfiled", {});

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied).toContain(UNDER_TEST);

		expect(
			connection.prepare("SELECT id, client_id, project_id, folder_id, deleted_at FROM documents ORDER BY id").all(),
		).toEqual([
			{ id: "in-client-folder", client_id: "acme", project_id: null, folder_id: null, deleted_at: null },
			{ id: "in-deleted-folder", client_id: "noord", project_id: null, folder_id: null, deleted_at: STAMP },
			{ id: "in-nested-folder", client_id: "acme", project_id: null, folder_id: null, deleted_at: null },
			{ id: "in-no-folder", client_id: "noord", project_id: null, folder_id: null, deleted_at: null },
			{ id: "in-own-folder", client_id: null, project_id: "own", folder_id: null, deleted_at: null },
			{ id: "in-project-folder", client_id: "acme", project_id: "site", folder_id: null, deleted_at: null },
			{ id: "in-unfiled-folder", client_id: null, project_id: null, folder_id: null, deleted_at: null },
			{ id: "unfiled", client_id: null, project_id: null, folder_id: null, deleted_at: null },
		]);

		// Only the documents that were in a folder were touched.
		const touched = connection.prepare("SELECT id FROM documents WHERE updated_at <> ? ORDER BY id").all(STAMP) as { id: string }[];
		expect(touched.map((row) => row.id)).toEqual([
			"in-client-folder",
			"in-deleted-folder",
			"in-nested-folder",
			"in-own-folder",
			"in-project-folder",
			"in-unfiled-folder",
		]);

		// Every folder is still a row, and none is live; the one deleted before keeps its date.
		const folders = connection.prepare("SELECT id, name, deleted_at FROM document_folders ORDER BY id").all() as {
			id: string;
			name: string;
			deleted_at: string | null;
		}[];
		expect(folders.map((row) => row.id)).toEqual(["f-client", "f-gone", "f-nested", "f-own", "f-project", "f-unfiled"]);
		expect(folders.every((row) => row.deleted_at !== null)).toBe(true);
		expect(folders.find((row) => row.id === "f-gone")?.deleted_at).toBe(STAMP);
		expect(folders.find((row) => row.id === "f-client")?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});
});
