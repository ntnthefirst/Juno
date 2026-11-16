/**
 * Documents as a file explorer (decision 75): any file is a document and is
 * matched by its bytes, its words or its name; where it is kept; moving,
 * duplicating, copying and renaming; a mail attachment kept as
 * a document; and signing refused for a newest version that is not a PDF.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as clients from "./clients";
import * as compare from "./document-compare";
import * as drag from "./document-drag";
import { analyseImport, importFile, importFromMail } from "./document-import";
import * as organise from "./document-organise";
import * as pages from "./pages";
import * as projects from "./projects";
import * as documents from "./documents";
import { configureDocumentStorage } from "./documents";
import { AGREEMENT, docxBytes, freshConnection, PNG_BYTES } from "./file-fixtures";
import { configureMailThreads } from "./mail-threads";
import { extractText } from "./pdf-text";

beforeAll(async () => {
	await extractText(new Uint8Array());
}, 60_000);

function bytes(fileName: string, data: Uint8Array | string, fileDate?: string) {
	return {
		kind: "bytes" as const,
		fileName,
		data: typeof data === "string" ? new Uint8Array(Buffer.from(data)) : data,
		...(fileDate ? { fileDate } : {}),
	};
}

async function setUp() {
	const { db, connection } = freshConnection();
	const storage = mkdtempSync(join(tmpdir(), "juno-explorer-"));
	configureDocumentStorage(storage);
	const acme = await clients.create({ name: "Acme" }, db);
	const other = await clients.create({ name: "Brouwerij Noord" }, db);
	const website = await projects.create({ name: "Website", clientId: acme.id }, db);
	const own = await projects.create({ name: "Eigen werk" }, db);
	return { db, connection, storage, acme, other, website, own };
}

describe("any file is a document", () => {
	it("keeps a Word file with its type, size and extension, under a name Juno builds", async () => {
		const { db, acme, storage } = await setUp();
		const docx = await docxBytes(AGREEMENT);
		const record = await importFile({ source: bytes("Overeenkomst.docx", docx), clientId: acme.id }, db);
		expect(record.title).toBe("Overeenkomst");
		expect(record.latestVersion).toMatchObject({
			fileName: "Overeenkomst.docx",
			mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			byteSize: docx.length,
		});
		expect(record.pdfPath!.startsWith(storage)).toBe(true);
		expect(record.pdfPath!.endsWith(".docx")).toBe(true);
	});

	it("names why an incoming file looks like one already kept: the same bytes, the same words, the same name", async () => {
		const { db, acme } = await setUp();
		const original = await docxBytes(AGREEMENT);
		const kept = await importFile({ source: bytes("Overeenkomst.docx", original), clientId: acme.id }, db);
		const notes = await importFile({ source: bytes("Notities.txt", "Bel de klant terug."), clientId: acme.id }, db);

		const same = await analyseImport({ source: bytes("kopie.docx", original), clientId: acme.id }, db);
		expect(same.matches[0]).toMatchObject({ documentId: kept.id, reason: "bytes", identical: true });

		const resaved = await docxBytes([...AGREEMENT, "Voor akkoord, de opdrachtgever."]);
		const words = await analyseImport({ source: bytes("getekend.docx", resaved), clientId: acme.id }, db);
		expect(words.matches[0]).toMatchObject({ documentId: kept.id, reason: "text", identical: false });
		expect(words.matches[0]!.latestVersion?.fileName).toBe("Overeenkomst.docx");

		const named = await analyseImport({ source: bytes("Notities.txt", "Iets heel anders."), clientId: acme.id }, db);
		expect(named.matches[0]).toMatchObject({ documentId: notes.id, reason: "name" });
		expect(named.availableTitle).toBe("Notities (2)");
		expect(named).toMatchObject({ mediaType: "text/plain", byteSize: 17 });
	});

	it("matches a picture by its bytes only", async () => {
		const { db, acme } = await setUp();
		const kept = await importFile({ source: bytes("Logo.png", PNG_BYTES), clientId: acme.id }, db);
		const analysis = await analyseImport({ source: bytes("logo-kopie.png", PNG_BYTES) }, db);
		expect(analysis.matches.map((match) => [match.documentId, match.reason])).toEqual([[kept.id, "bytes"]]);
	});
});

describe("documents kept under no client and no project", () => {
	it("lists only those, newest first, and drops one once it has a place or is deleted", async () => {
		const { db, acme, website } = await setUp();
		const loose = await importFile({ source: bytes("Losse notitie.txt", "los") }, db);
		const older = await importFile({ source: bytes("Oud bonnetje.txt", "oud") }, db);
		await importFile({ source: bytes("Offerte.txt", "offerte"), clientId: acme.id }, db);
		await importFile({ source: bytes("Plan.txt", "plan"), projectId: website.id }, db);
		expect((await documents.listUnfiled(db)).map((record) => record.title)).toEqual([older.title, loose.title]);

		await documents.link(loose.id, { projectId: website.id }, db);
		await documents.remove(older.id, db);
		expect(await documents.listUnfiled(db)).toEqual([]);
	});
});

describe("the name a file is kept under", () => {
	it("never repeats, even for one title in one millisecond", () => {
		const names = Array.from({ length: 50 }, () => documents.fileNameFor("Offerte", "-import", "docx"));
		expect(new Set(names).size).toBe(50);
		expect(names[0]).toMatch(/^offerte-[0-9TZ-]+-[a-f0-9]+-import\.docx$/);
	});
});

describe("where a document is kept", () => {
	it("carries a project's documents to its new client, and to none", async () => {
		const { db, acme, other, website } = await setUp();
		const loose = await importFile({ source: bytes("Plan.txt", "Een plan."), projectId: website.id }, db);
		const acmeOwn = await importFile({ source: bytes("Brief.txt", "Voor Acme."), clientId: acme.id }, db);

		await projects.update(website.id, { clientId: other.id }, db);
		expect(await documents.get(loose.id, db)).toMatchObject({ clientId: other.id, projectId: website.id });
		expect(await documents.get(acmeOwn.id, db)).toMatchObject({ clientId: acme.id });

		await projects.update(website.id, { clientId: null }, db);
		expect(await documents.get(loose.id, db)).toMatchObject({ clientId: null, projectId: website.id });
	});

	it("refuses to change a project's client when the new client has a document of the same title, and changes nothing", async () => {
		const { db, acme, other, website } = await setUp();
		const mine = await importFile({ source: bytes("Offerte.txt", "Voor Acme."), projectId: website.id }, db);
		await importFile({ source: bytes("Offerte.txt", "Voor Noord."), clientId: other.id }, db);

		await expect(projects.update(website.id, { clientId: other.id }, db)).rejects.toThrow(
			/Brouwerij Noord already has a document named "Offerte"/,
		);
		expect((await projects.get(website.id, db))?.clientId).toBe(acme.id);
		expect(await documents.get(mine.id, db)).toMatchObject({ clientId: acme.id });
	});

	it("makes a page under the project it was started from, with its client", async () => {
		const { db, acme, website } = await setUp();
		const page = await pages.create({ projectId: website.id }, db);
		expect(page.document).toMatchObject({ clientId: acme.id, projectId: website.id, sourceKind: "page" });
		expect((await documents.list({ clientId: acme.id }, db)).map((row) => row.id)).toEqual([page.document.id]);
	});

	it("brings a deleted document back where it was kept", async () => {
		const { db, acme } = await setUp();
		const doc = await importFile({ source: bytes("Offerte.txt", "Een offerte."), clientId: acme.id }, db);
		await documents.remove(doc.id, db);
		expect(await documents.restore(doc.id, db)).toMatchObject({ clientId: acme.id, projectId: null });
	});
});

describe("dragging documents out of Juno", () => {
	it("drags a copy of each newest file under its title, leaves out a page, and never the kept file itself", async () => {
		const { db, acme, storage } = await setUp();
		drag.configureDragRoot(join(storage, "drag"));
		const first = await importFile({ source: bytes("offerte.txt", "Een offerte."), clientId: acme.id, title: "Offerte" }, db);
		const second = await importFile({ source: bytes("Brief.txt", "Een brief."), clientId: acme.id }, db);
		const page = await pages.create({ title: "Notities", clientId: acme.id }, db);

		const files = await drag.dragFiles([first.id, second.id, page.document.id], db);
		expect(files.map((file) => file.split(/[\\/]/).pop())).toEqual(["Offerte.txt", "Brief.txt"]);
		expect(readFileSync(files[0]!, "utf8")).toBe("Een offerte.");
		expect(files.every((file) => !file.startsWith(join(storage, "documents")) && file !== first.pdfPath)).toBe(true);

		// The next drag clears the copies of the one before.
		const again = await drag.dragFiles([second.id], db);
		expect(existsSync(files[0]!)).toBe(false);
		expect(existsSync(again[0]!)).toBe(true);
	});
});

describe("comparing an incoming file with a kept one", () => {
	it("marks the words a dropped file adds and leaves out, and names a side it cannot read", async () => {
		const { db, acme } = await setUp();
		const kept = await importFile({ source: bytes("Offerte.txt", "De prijs is 100 euro per maand."), clientId: acme.id }, db);
		const versionId = kept.latestVersion!.id;

		const result = await compare.compareText(
			{ before: { kind: "version", versionId }, after: bytes("Offerte getekend.txt", "De prijs is 120 euro per maand. Getekend.") },
			db,
		);
		expect(result).toMatchObject({ status: "compared", added: 2, removed: 1 });

		const picture = await compare.compareText({ before: { kind: "version", versionId }, after: bytes("Foto.png", PNG_BYTES) }, db);
		expect(picture).toEqual({ status: "unreadable", side: "after" });
	});
});

describe("moving, duplicating, copying and renaming", () => {
	it("moves a document to another client's project, relinking it by the owner rule", async () => {
		const { db, other, website, acme } = await setUp();
		const doc = await importFile({ source: bytes("Schets.txt", "Een schets."), clientId: other.id }, db);
		const moved = await organise.move(doc.id, { projectId: website.id }, db);
		expect(moved).toMatchObject({ clientId: acme.id, projectId: website.id });

		await expect(organise.move(doc.id, { clientId: other.id, projectId: website.id }, db)).rejects.toThrow();
	});

	it("lists a client's documents with its projects', and a project's alone", async () => {
		const { db, acme, website } = await setUp();
		const atClient = await importFile({ source: bytes("B.txt", "b"), clientId: acme.id }, db);
		const atProject = await importFile({ source: bytes("C.txt", "c"), projectId: website.id }, db);
		const ids = async (query: { clientId?: string; projectId?: string }) => (await documents.list(query, db)).map((record) => record.id).sort();
		expect(await ids({ clientId: acme.id })).toEqual([atClient.id, atProject.id].sort());
		expect(await ids({ projectId: website.id })).toEqual([atProject.id]);
	});

	it("duplicates in the same place as '(copy)', copying the file with its extension", async () => {
		const { db, acme } = await setUp();
		const docx = await docxBytes(AGREEMENT);
		const original = await importFile({ source: bytes("Offerte.docx", docx), clientId: acme.id }, db);

		const copy = await organise.duplicate(original.id, db);
		expect(copy).toMatchObject({ title: "Offerte (copy)", clientId: acme.id, versionCount: 1 });
		expect(copy.pdfPath).not.toBe(original.pdfPath);
		expect(copy.pdfPath!.endsWith(".docx")).toBe(true);
		expect(Buffer.compare(readFileSync(copy.pdfPath!), Buffer.from(docx))).toBe(0);
		expect(copy.latestVersion).toMatchObject({ fileName: "Offerte.docx", mediaType: original.latestVersion!.mediaType });

		const second = await organise.duplicate(original.id, db);
		expect(second.title).toBe("Offerte (copy 2)");
	});

	it("copies to another client keeping the title when it is free there", async () => {
		const { db, acme, other } = await setUp();
		const original = await importFile({ source: bytes("Voorwaarden.txt", "Onze voorwaarden."), clientId: acme.id }, db);
		const copied = await organise.copyTo(original.id, { clientId: other.id }, db);
		expect(copied).toMatchObject({ title: "Voorwaarden", clientId: other.id });
		const again = await organise.copyTo(original.id, { clientId: other.id }, db);
		expect(again.title).toBe("Voorwaarden (copy)");
		expect((await documents.get(original.id, db))!.clientId).toBe(acme.id);
	});

	it("renames the title only, and refuses a title taken in the same place", async () => {
		const { db, acme } = await setUp();
		const one = await importFile({ source: bytes("Een.txt", "1"), clientId: acme.id }, db);
		await importFile({ source: bytes("Twee.txt", "2"), clientId: acme.id }, db);
		const renamed = await organise.rename(one.id, "  Eerste  brief ", db);
		expect(renamed.title).toBe("Eerste brief");
		expect(renamed.pdfPath).toBe(one.pdfPath);
		await expect(organise.rename(one.id, "twee", db)).rejects.toThrow(/already has a document named "twee"/);
	});
});

describe("a mail attachment kept as a document", () => {
	async function withAttachment(connection: ReturnType<typeof freshConnection>["connection"], clientId: string, fileName: string, data: Uint8Array) {
		const mailDir = mkdtempSync(join(tmpdir(), "juno-explorer-mail-"));
		configureMailThreads(mailDir);
		writeFileSync(join(mailDir, "att-1.bin"), data);
		const stamp = "2026-03-02T00:00:00.000Z";
		const run = (sql: string, ...values: unknown[]) => connection.prepare(sql).run(...values);
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
			"thr", "owner", stamp, stamp, "acc", "Prijzen", "prijzen", clientId, stamp, stamp,
		);
		run(
			"INSERT INTO mail_messages (id, owner_id, created_at, updated_at, account_id, folder_id, thread_id, uid, sent_at, internal_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"msg", "owner", stamp, stamp, "acc", "fold", "thr", 1, "2026-03-04T09:00:00.000Z", stamp,
		);
		run(
			"INSERT INTO mail_attachments (id, owner_id, created_at, updated_at, message_id, filename, mime_type, size, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			"att", "owner", stamp, stamp, "msg", fileName, "application/octet-stream", data.length, "att-1.bin",
		);
	}

	it("keeps any attachment under the conversation's client, or adds it as a version after the match check", async () => {
		const { db, connection, acme } = await setUp();
		const docx = await docxBytes(AGREEMENT);
		await withAttachment(connection, acme.id, "Overeenkomst.docx", docx);

		const first = await importFromMail({ attachmentId: "att" }, db);
		expect(first.addedAsVersion).toBe(false);
		expect(first.document).toMatchObject({ title: "Overeenkomst", clientId: acme.id });
		expect(first.version).toMatchObject({ source: "mail", mailAttachmentId: "att", fileDate: "2026-03-04T09:00:00.000Z" });

		const analysis = await analyseImport({ source: { kind: "attachment", attachmentId: "att" } }, db);
		expect(analysis.matches[0]).toMatchObject({ documentId: first.document.id, reason: "bytes" });
		await expect(importFromMail({ attachmentId: "att", versionOf: first.document.id }, db)).rejects.toThrow(
			/already version 1/,
		);
	});
});

describe("signing a document that is not a PDF", () => {
	it("is refused with a sentence saying to convert it first, and its bytes are not handed to the stamp page", async () => {
		const { db, acme } = await setUp();
		const record = await importFile({ source: bytes("Overeenkomst.docx", await docxBytes(AGREEMENT)), clientId: acme.id }, db);
		expect(() => documents.assertSignable(record)).toThrow(
			'The newest version of "Overeenkomst" is not a PDF. Convert it to PDF first, then sign the PDF.',
		);
		await expect(documents.readPdfBytes(record.id, db)).rejects.toThrow(/Convert it to PDF first/);
		// The specimen rule is checked first and stays.
		expect(() => documents.assertSignable({ ...record, isSpecimen: true })).toThrow(/never reviewed/);
	});
});
