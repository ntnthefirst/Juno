/**
 * Migration 0015 turns every PDF a document already had into a version: the
 * generated or imported file, and each signed copy. Tested against a database
 * with those rows in it, because against an empty one the backfill has nothing
 * to carry (.claude/rules/data.md section 3).
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const CUT = "0015_document_versions.sql";

let folder: string;

beforeEach(() => {
	folder = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql") && name < CUT)) {
		copyFileSync(join(MIGRATIONS, file), join(folder, file));
	}
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("the document versions backfill in migration 0015", () => {
	it("records the original and each signed copy, and points the document at the newest", () => {
		const connection = openDatabase(":memory:");
		runMigrations(connection, folder);

		const stamp = "2026-01-01T00:00:00.000Z";
		const run = (sql: string, ...values: unknown[]) => connection.prepare(sql).run(...values);
		run(
			"INSERT INTO clients (id, owner_id, created_at, updated_at, name, sort_name) VALUES (?, ?, ?, ?, ?, ?)",
			"client-1", "owner", stamp, stamp, "Acme", "acme",
		);
		run(
			"INSERT INTO documents (id, owner_id, created_at, updated_at, client_id, title, body_html, pdf_path, source_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"doc-1", "owner", stamp, stamp, "client-1", "Contract", "<p>x</p>", "/docs/contract.pdf", "generated",
		);
		run(
			"INSERT INTO documents (id, owner_id, created_at, updated_at, client_id, title, body_html, pdf_path, source_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"doc-2", "owner", stamp, stamp, "client-1", "Draft", "<p>x</p>", null, "generated",
		);
		const signature =
			"INSERT INTO document_signatures (id, owner_id, created_at, updated_at, document_id, signer_name, signed_at, document_hash, signed_pdf_path, audit_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
		run(signature, "sig-1", "owner", stamp, stamp, "doc-1", "Nathan", "2026-02-01T00:00:00.000Z", "h", "/docs/stamped.pdf", '{"digital":null}');
		run(signature, "sig-2", "owner", stamp, stamp, "doc-1", "Nathan", "2026-03-01T00:00:00.000Z", "h", "/docs/signed.pdf", '{"digital":{"subject":"x"}}');

		runMigrations(connection, MIGRATIONS);

		const rows = connection
			.prepare("SELECT document_id, kind, source, pdf_path, signature_id FROM document_versions ORDER BY file_date")
			.all() as { document_id: string; kind: string; source: string; pdf_path: string; signature_id: string | null }[];
		expect(rows).toEqual([
			{ document_id: "doc-1", kind: "generated", source: "generate", pdf_path: "/docs/contract.pdf", signature_id: null },
			{ document_id: "doc-1", kind: "stamped", source: "sign", pdf_path: "/docs/stamped.pdf", signature_id: "sig-1" },
			{ document_id: "doc-1", kind: "signed", source: "sign", pdf_path: "/docs/signed.pdf", signature_id: "sig-2" },
		]);
		const documents = connection.prepare("SELECT id, pdf_path FROM documents ORDER BY id").all();
		expect(documents).toEqual([
			{ id: "doc-1", pdf_path: "/docs/signed.pdf" },
			{ id: "doc-2", pdf_path: null },
		]);
	});
});
