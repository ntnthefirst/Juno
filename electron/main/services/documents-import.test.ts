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
import * as documents from "./documents";
import { configureDocumentStorage, importPdf, importPdfBytes } from "./documents";

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

describe("documents import names and bytes", () => {
	async function setup() {
		const db = freshDb();
		configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-import-storage-")));
		const sourceDir = mkdtempSync(join(tmpdir(), "juno-import-source-"));
		return { db, sourceDir };
	}

	it("refuses a second import with the same name for the same client", async () => {
		const { db, sourceDir } = await setup();
		const client = await clients.create({ name: "Acme" }, db);
		const source = writePdfFixture(sourceDir, "Contract.pdf");
		await importPdf({ sourcePath: source, clientId: client.id }, db);
		await expect(importPdf({ sourcePath: source, clientId: client.id }, db)).rejects.toThrow(
			/Acme already has a document named "Contract"/,
		);
	});

	it("allows the same name for another client", async () => {
		const { db, sourceDir } = await setup();
		const a = await clients.create({ name: "Acme" }, db);
		const b = await clients.create({ name: "Beta" }, db);
		const source = writePdfFixture(sourceDir, "Contract.pdf");
		await importPdf({ sourcePath: source, clientId: a.id }, db);
		await expect(importPdf({ sourcePath: source, clientId: b.id }, db)).resolves.toBeDefined();
	});

	it("ignores case, and frees the name once the document is deleted", async () => {
		const { db, sourceDir } = await setup();
		const client = await clients.create({ name: "Acme" }, db);
		const first = await importPdf({ sourcePath: writePdfFixture(sourceDir, "Contract.pdf"), clientId: client.id }, db);
		await expect(
			importPdf({ sourcePath: writePdfFixture(sourceDir, "contract.pdf"), clientId: client.id }, db),
		).rejects.toThrow(/already has a document/);
		await documents.remove(first.id, db);
		await expect(
			importPdf({ sourcePath: writePdfFixture(sourceDir, "contract.pdf"), clientId: client.id }, db),
		).resolves.toBeDefined();
	});

	it("imports dropped bytes and refuses a non-PDF", async () => {
		const { db } = await setup();
		const client = await clients.create({ name: "Acme" }, db);
		const data = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF"));
		const record = await importPdfBytes({ fileName: "Offer.pdf", data, clientId: client.id }, db);
		expect(record.title).toBe("Offer");
		expect(readFileSync(record.pdfPath!)).toEqual(Buffer.from(data));
		await expect(
			importPdfBytes({ fileName: "notes.pdf", data: new Uint8Array(Buffer.from("hello")), clientId: client.id }, db),
		).rejects.toThrow(/is not a PDF/);
		await expect(importPdfBytes({ fileName: "Offer.pdf", data, clientId: client.id }, db)).rejects.toThrow(
			/already has a document named "Offer"/,
		);
	});
});
