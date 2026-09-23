/**
 * Runs under plain Node through Vitest, not inside Electron. Each test gets its
 * own in-memory database built from the committed migrations, and its own temp
 * folders for the source file and the configured documents directory, so
 * nothing here touches a real userData path.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clients from "./clients";
import { configureDocumentStorage, importPdf } from "./documents";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

/** A file that starts with a real PDF header. Good enough: importPdf only checks the header and copies it. */
function writePdfFixture(dir: string, name = "source.pdf"): string {
	const path = join(dir, name);
	writeFileSync(path, "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< >>\nendobj\n%%EOF");
	return path;
}

describe("documents.importPdf", () => {
	it("imports a real PDF and records it as imported", async () => {
		const db = freshDb();
		const storageDir = mkdtempSync(join(tmpdir(), "juno-import-storage-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "juno-import-source-"));
		configureDocumentStorage(storageDir);

		const client = await clients.create({ name: "Acme" }, db);
		const source = writePdfFixture(sourceDir);

		const record = await importPdf({ sourcePath: source, clientId: client.id }, db);

		expect(record.sourceKind).toBe("imported");
		expect(record.isSpecimen).toBe(false);
		expect(record.templateId).toBeNull();
		expect(record.pdfPath).not.toBeNull();
		expect(readFileSync(record.pdfPath!)).toEqual(readFileSync(source));
	});

	it("refuses a file that is not a PDF", async () => {
		const db = freshDb();
		const storageDir = mkdtempSync(join(tmpdir(), "juno-import-storage-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "juno-import-source-"));
		configureDocumentStorage(storageDir);

		const client = await clients.create({ name: "Acme" }, db);
		const source = join(sourceDir, "not-a-pdf.txt");
		writeFileSync(source, "hello, this is plain text");

		await expect(importPdf({ sourcePath: source, clientId: client.id }, db)).rejects.toThrow(
			/is not a PDF/,
		);
	});

	it("refuses a path that does not exist", async () => {
		const db = freshDb();
		const storageDir = mkdtempSync(join(tmpdir(), "juno-import-storage-"));
		configureDocumentStorage(storageDir);

		const client = await clients.create({ name: "Acme" }, db);
		const missing = join(storageDir, "nope.pdf");

		await expect(importPdf({ sourcePath: missing, clientId: client.id }, db)).rejects.toThrow(
			/Could not find/,
		);
	});

	it("does not let a title carrying ../ escape the documents directory", async () => {
		const db = freshDb();
		const storageDir = mkdtempSync(join(tmpdir(), "juno-import-storage-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "juno-import-source-"));
		configureDocumentStorage(storageDir);

		const client = await clients.create({ name: "Acme" }, db);
		const source = writePdfFixture(sourceDir);

		const record = await importPdf(
			{ sourcePath: source, clientId: client.id, title: "../../../etc/evil" },
			db,
		);

		expect(record.pdfPath).not.toBeNull();
		expect(dirname(record.pdfPath!)).toBe(storageDir);
	});
});
