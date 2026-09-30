/**
 * Runs under plain Node through Vitest, not inside Electron. Each test gets its
 * own in-memory database built from the committed migrations, and its own temp
 * folders for the source file and the configured documents directory, so
 * nothing here touches a real userData path.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clients from "./clients";
import * as documents from "./documents";
import { addVersion, analyseImport, importFile, importPdf } from "./document-import";
import * as versions from "./document-versions";
import { configureDocumentStorage } from "./documents";
import { configureMailThreads } from "./mail-threads";

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
		const bytes = (fileName: string, body = data) => ({ kind: "bytes" as const, fileName, data: body });
		const record = await importFile({ source: bytes("Offer.pdf"), clientId: client.id }, db);
		expect(record.title).toBe("Offer");
		expect(record.versionCount).toBe(1);
		expect(readFileSync(record.pdfPath!)).toEqual(Buffer.from(data));
		await expect(
			importFile({ source: bytes("notes.pdf", new Uint8Array(Buffer.from("hello"))), clientId: client.id }, db),
		).rejects.toThrow(/is not a PDF/);
		await expect(importFile({ source: bytes("Offer.pdf"), clientId: client.id }, db)).rejects.toThrow(
			/already has a document named "Offer"/,
		);
	});

	it("refuses a path from the window", async () => {
		const { db } = await setup();
		const client = await clients.create({ name: "Acme" }, db);
		const source = { kind: "path", path: "/etc/passwd" } as unknown as Parameters<typeof importFile>[0]["source"];
		await expect(importFile({ source, clientId: client.id }, db)).rejects.toThrow(/drop, the file picker or a mail/);
	});
});

async function textPdf(lines: string[]): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage();
	lines.forEach((line, index) => page.drawText(line, { x: 40, y: 780 - index * 14, size: 9, font }));
	return doc.save();
}

const CONTRACT = [
	"Overeenkomst voor het ontwikkelen van een website tussen de opdrachtgever en de opdrachtnemer.",
	"De opdrachtnemer levert de website op binnen de afgesproken termijn en bezorgt alle bestanden.",
	"Betaling gebeurt binnen dertig dagen na ontvangst van de factuur op het vermelde rekeningnummer.",
];

describe("document versions", () => {
	async function withDocument() {
		const db = freshDb();
		configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-versions-")));
		const client = await clients.create({ name: "Acme" }, db);
		const original = await textPdf(CONTRACT);
		const record = await importFile(
			{
				source: { kind: "bytes", fileName: "Contract.pdf", data: original, fileDate: "2026-03-01T10:00:00.000Z" },
				clientId: client.id,
			},
			db,
		);
		return { db, client, record, original };
	}

	it("puts a newer file on top and follows it with the document's PDF", async () => {
		const { db, record } = await withDocument();
		const signed = await textPdf([...CONTRACT, "Getekend door de klant"]);
		const version = await addVersion(
			{
				documentId: record.id,
				source: { kind: "bytes", fileName: "Contract getekend.pdf", data: signed, fileDate: "2026-03-05T10:00:00.000Z" },
			},
			db,
		);
		expect(version.number).toBe(2);
		expect(version.isLatest).toBe(true);
		const reloaded = await documents.get(record.id, db);
		expect(reloaded?.versionCount).toBe(2);
		expect(readFileSync(reloaded!.pdfPath!)).toEqual(Buffer.from(signed));
	});

	it("slots an older file in between rather than on top", async () => {
		const { db, record } = await withDocument();
		await addVersion(
			{
				documentId: record.id,
				source: { kind: "bytes", fileName: "v3.pdf", data: await textPdf([...CONTRACT, "drie"]), fileDate: "2026-03-10T00:00:00.000Z" },
			},
			db,
		);
		const late = await addVersion(
			{
				documentId: record.id,
				source: { kind: "bytes", fileName: "v2.pdf", data: await textPdf([...CONTRACT, "twee"]), fileDate: "2026-03-05T00:00:00.000Z" },
			},
			db,
		);
		expect(late.number).toBe(2);
		expect(late.isLatest).toBe(false);
		const list = versions.list(record.id, db);
		expect(list.map((entry) => entry.fileName)).toEqual(["v3.pdf", "v2.pdf", "Contract.pdf"]);
	});

	it("refuses the same file twice", async () => {
		const { db, record, original } = await withDocument();
		await expect(
			addVersion({ documentId: record.id, source: { kind: "bytes", fileName: "again.pdf", data: original } }, db),
		).rejects.toThrow(/already version 1 of Contract/);
	});

	it("recognises a signed copy by its text, across clients, and a same-named file for the client", async () => {
		const { db, client, record } = await withDocument();
		const signed = await textPdf([...CONTRACT, "Nathan Perron", "Ondertekend op 30/09/2026 om 10:25"]);
		const byText = await analyseImport({ source: { kind: "bytes", fileName: "scan.pdf", data: signed } }, db);
		expect(byText.matches[0]).toMatchObject({ documentId: record.id, reason: "text", identical: false });
		expect(byText.suggestedClientId).toBe(client.id);

		const unrelated = await textPdf(["Een heel andere brief over iets anders, met genoeg woorden om te tellen.", "Nog een zin die nergens op lijkt, echt helemaal niet, zo verschillend als het maar kan."]);
		const byName = await analyseImport(
			{ source: { kind: "bytes", fileName: "contract.pdf", data: unrelated }, clientId: client.id },
			db,
		);
		expect(byName.matches).toEqual([expect.objectContaining({ documentId: record.id, reason: "name" })]);

		const nothing = await analyseImport({ source: { kind: "bytes", fileName: "brief.pdf", data: unrelated } }, db);
		expect(nothing.matches).toEqual([]);
	});
});

describe("a mail attachment as a version", () => {
	it("reads the file from the mail folder, dates it by the message and suggests the thread's client", async () => {
		const connection = openDatabase(":memory:");
		runMigrations(connection, MIGRATIONS);
		const db = createDrizzle(connection);
		configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-mail-docs-")));
		const mailDir = mkdtempSync(join(tmpdir(), "juno-mail-dir-"));
		configureMailThreads(mailDir);

		const client = await clients.create({ name: "Acme" }, db);
		const original = await textPdf(CONTRACT);
		const record = await importFile(
			{ source: { kind: "bytes", fileName: "Contract.pdf", data: original, fileDate: "2026-03-01T10:00:00.000Z" }, clientId: client.id },
			db,
		);
		writeFileSync(join(mailDir, "att-1.pdf"), await textPdf([...CONTRACT, "Voor akkoord"]));

		const stamp = "2026-03-02T00:00:00.000Z";
		const run = (statement: string, ...values: unknown[]) => connection.prepare(statement).run(...values);
		run(
			"INSERT INTO mail_accounts (id, owner_id, created_at, updated_at, label, email, imap_host, imap_port, username, credential_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"acc", "owner", stamp, stamp, "Work", "me@example.test", "imap.example.test", 993, "me", "key",
		);
		run(
			"INSERT INTO mail_folders (id, owner_id, created_at, updated_at, account_id, path, name) VALUES (?, ?, ?, ?, ?, ?, ?)",
			"fold", "owner", stamp, stamp, "acc", "INBOX", "Inbox",
		);
		run(
			"INSERT INTO mail_threads (id, owner_id, created_at, updated_at, account_id, subject, subject_norm, client_id, first_message_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"thr", "owner", stamp, stamp, "acc", "Contract", "contract", client.id, stamp, stamp,
		);
		run(
			"INSERT INTO mail_messages (id, owner_id, created_at, updated_at, account_id, folder_id, thread_id, uid, sent_at, internal_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"msg", "owner", stamp, stamp, "acc", "fold", "thr", 1, "2026-03-04T09:00:00.000Z", stamp,
		);
		run(
			"INSERT INTO mail_attachments (id, owner_id, created_at, updated_at, message_id, filename, mime_type, size, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"att", "owner", stamp, stamp, "msg", "Contract ondertekend.pdf", "application/pdf", 1, "att-1.pdf",
		);

		const analysis = await analyseImport({ source: { kind: "attachment", attachmentId: "att" } }, db);
		expect(analysis.suggestedClientId).toBe(client.id);
		expect(analysis.matches[0]?.documentId).toBe(record.id);

		const version = await addVersion({ documentId: record.id, source: { kind: "attachment", attachmentId: "att" } }, db);
		expect(version).toMatchObject({ source: "mail", mailAttachmentId: "att", fileDate: "2026-03-04T09:00:00.000Z", isLatest: true });
	});
});
