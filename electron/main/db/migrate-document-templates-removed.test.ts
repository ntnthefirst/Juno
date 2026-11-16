/**
 * Migration 0036 soft deletes every document template, its pictures, every
 * component and theirs (decision 82). It runs against a database that already
 * holds them, one deleted earlier, and documents made from a template, because
 * an empty database proves nothing about a data change.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const BEFORE = "0035_documents_out_of_folders.sql";
const UNDER_TEST = "0036_document_templates_soft_deleted.sql";
const STAMP = "2026-01-01T00:00:00.000Z";
const EARLIER = "2025-06-01T00:00:00.000Z";

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

function seed(connection: ShimDatabase): void {
	insert(connection, "clients", { id: "client-1", name: "De Backer BV", sort_name: "de backer bv" });
	insert(connection, "document_templates", { id: "tpl-live", key: "offerte", name: "Offerte", body_html: "<p>{{ client.name }}</p>" });
	insert(connection, "document_templates", { id: "tpl-gone", key: "oud", name: "Oud", body_html: "<p>x</p>", deleted_at: EARLIER });
	insert(connection, "document_template_assets", {
		id: "asset-1",
		template_id: "tpl-live",
		file_name: "logo.png",
		mime_type: "image/png",
		byte_size: 10,
		file_hash: "abc",
		relative_path: "asset-1.png",
	});
	insert(connection, "document_components", { id: "component-1", name: "Briefhoofd", root_json: "{}" });
	insert(connection, "document_component_assets", {
		id: "component-asset-1",
		component_id: "component-1",
		file_name: "logo.png",
		mime_type: "image/png",
		byte_size: 10,
		file_hash: "abc",
		relative_path: "component-asset-1.png",
	});
	// A document made from the template, and one that was not.
	insert(connection, "documents", {
		id: "made",
		client_id: "client-1",
		template_id: "tpl-live",
		template_version: 3,
		title: "Offerte De Backer",
		body_html: "<p>De Backer BV</p>",
		source_kind: "generated",
		is_specimen: 1,
	});
	insert(connection, "documents", { id: "file", client_id: "client-1", title: "Factuur", body_html: "", source_kind: "imported" });
}

beforeEach(() => {
	folder = upToBefore();
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("removing document templates in migration 0036", () => {
	it("soft deletes every template, component and picture, and leaves the documents alone", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);
		seed(connection);

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied[0]).toBe(UNDER_TEST);

		for (const table of ["document_templates", "document_template_assets", "document_components", "document_component_assets"]) {
			const live = connection.prepare(`SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NULL`).get() as { n: number };
			expect(live.n, table).toBe(0);
		}
		const templates = connection.prepare("SELECT id, deleted_at, updated_at FROM document_templates ORDER BY id").all() as {
			id: string;
			deleted_at: string;
			updated_at: string;
		}[];
		expect(templates).toHaveLength(2);
		const live = templates.find((row) => row.id === "tpl-live")!;
		// A UTC timestamp written by the migration, not a literal.
		expect(live.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(live.deleted_at > STAMP).toBe(true);
		expect(live.updated_at).toBe(live.deleted_at);
		// One deleted before keeps the time it was deleted at.
		expect(templates.find((row) => row.id === "tpl-gone")).toMatchObject({ deleted_at: EARLIER, updated_at: STAMP });

		const documents = connection.prepare("SELECT id, template_id, title, body_html, deleted_at, updated_at FROM documents ORDER BY id").all();
		expect(documents).toEqual([
			{ id: "file", template_id: null, title: "Factuur", body_html: "", deleted_at: null, updated_at: STAMP },
			{ id: "made", template_id: "tpl-live", title: "Offerte De Backer", body_html: "<p>De Backer BV</p>", deleted_at: null, updated_at: STAMP },
		]);
		expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	});
});
