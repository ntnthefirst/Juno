/**
 * Documents as a file explorer (decision 75): any file is a document and is
 * matched by its bytes, its words or its name; the owner's folders and the
 * tree; moving, duplicating, copying and renaming; a mail attachment kept as
 * a document; and signing refused for a newest version that is not a PDF.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as clients from "./clients";
import * as folders from "./document-folders";
import { analyseImport, importFile, importFromMail } from "./document-import";
import * as organise from "./document-organise";
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

describe("the name a file is kept under", () => {
	it("never repeats, even for one title in one millisecond", () => {
		const names = Array.from({ length: 50 }, () => documents.fileNameFor("Offerte", "-import", "docx"));
		expect(new Set(names).size).toBe(50);
		expect(names[0]).toMatch(/^offerte-[0-9TZ-]+-[a-f0-9]+-import\.docx$/);
	});
});

describe("folders", () => {
	it("makes folders inside a client, a project and Unfiled, and draws them in the tree with counts", async () => {
		const { db, acme, website, own } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		const drafts = await folders.create({ name: "Concepten", parentId: offers.id }, db);
		const designs = await folders.create({ name: "Ontwerpen", projectId: website.id }, db);
		const loose = await folders.create({ name: "Varia" }, db);
		expect(drafts).toMatchObject({ clientId: acme.id, projectId: null, parentId: offers.id });
		expect(designs).toMatchObject({ clientId: acme.id, projectId: website.id });

		await importFile({ source: bytes("Offerte.txt", "Een offerte."), folderId: drafts.id }, db);
		await importFile({ source: bytes("Brief.txt", "Een brief."), clientId: acme.id }, db);
		await importFile({ source: bytes("Los.txt", "Los.") }, db);

		const tree = await folders.tree(db);
		expect(tree.roots.map((node) => node.key)).toEqual([
			`client:${acme.id}`,
			expect.stringMatching(/^client:/),
			`project:${own.id}`,
			"unfiled",
			"templates",
		]);
		const acmeNode = tree.roots[0]!;
		expect(acmeNode.documentCount).toBe(1);
		expect(acmeNode.children.map((node) => node.key)).toEqual([`project:${website.id}`, `folder:${offers.id}`]);
		expect(acmeNode.children[0]!.children[0]).toMatchObject({ key: `folder:${designs.id}`, kind: "folder" });
		const offersNode = acmeNode.children[1]!;
		expect(offersNode.children[0]).toMatchObject({ name: "Concepten", documentCount: 1 });
		expect(offersNode.children[0]!.place).toEqual({ clientId: acme.id, projectId: null, folderId: drafts.id });
		const unfiled = tree.roots.find((node) => node.key === "unfiled")!;
		expect(unfiled.documentCount).toBe(1);
		expect(unfiled.children.map((node) => node.folderId)).toEqual([loose.id]);
		expect(tree.templates).toEqual([]);
	});

	it("keeps names unique beside each other, and renames", async () => {
		const { db, acme } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		await expect(folders.create({ name: "offertes ", clientId: acme.id }, db)).rejects.toThrow(/already a folder named/);
		await expect(folders.create({ name: "Offertes" }, db)).resolves.toBeDefined();
		await expect(folders.create({ name: "   " }, db)).rejects.toThrow(/needs a name/);
		expect((await folders.rename(offers.id, "Prijsoffertes", db)).name).toBe("Prijsoffertes");
	});

	it("refuses to delete a folder that holds something, saying what, and deletes an empty one", async () => {
		const { db, acme } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		await folders.create({ name: "Oud", parentId: offers.id }, db);
		await importFile({ source: bytes("A.txt", "a"), folderId: offers.id }, db);
		await importFile({ source: bytes("B.txt", "b"), folderId: offers.id }, db);
		await expect(folders.remove(offers.id, db)).rejects.toThrow('"Offertes" still holds 2 documents and 1 folder. Move or delete them first.');

		const empty = await folders.create({ name: "Leeg", clientId: acme.id }, db);
		expect((await folders.remove(empty.id, db)).deletedAt).not.toBeNull();
		expect((await folders.list(db)).map((folder) => folder.name)).not.toContain("Leeg");
	});

	it("moves a folder to another client with everything inside it, and never into itself", async () => {
		const { db, acme, other } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		const inner = await folders.create({ name: "Oud", parentId: offers.id }, db);
		const doc = await importFile({ source: bytes("Offerte.txt", "Een offerte."), folderId: inner.id }, db);

		await expect(folders.move(offers.id, { parentId: inner.id }, db)).rejects.toThrow(/inside it/);
		await expect(folders.move(offers.id, { parentId: offers.id }, db)).rejects.toThrow(/into itself/);

		const moved = await folders.move(offers.id, { clientId: other.id }, db);
		expect(moved).toMatchObject({ clientId: other.id, parentId: null });
		expect(await folders.get(inner.id, db)).toMatchObject({ clientId: other.id, parentId: offers.id });
		expect(await documents.get(doc.id, db)).toMatchObject({ clientId: other.id, folderId: inner.id });
	});

	it("refuses to move a folder where one of its documents' titles is taken, and moves nothing", async () => {
		const { db, acme, other } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		const doc = await importFile({ source: bytes("Offerte.txt", "Voor Acme."), folderId: offers.id }, db);
		await importFile({ source: bytes("Offerte.txt", "Voor Noord."), clientId: other.id }, db);

		await expect(folders.move(offers.id, { clientId: other.id }, db)).rejects.toThrow(
			/Brouwerij Noord already has a document named "Offerte"/,
		);
		expect(await folders.get(offers.id, db)).toMatchObject({ clientId: acme.id });
		expect(await documents.get(doc.id, db)).toMatchObject({ clientId: acme.id, folderId: offers.id });
	});

	it("restores a folder only where its name is still free", async () => {
		const { db, acme } = await setUp();
		const first = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		await folders.remove(first.id, db);
		await folders.create({ name: "Offertes", clientId: acme.id }, db);
		await expect(folders.restore(first.id, db)).rejects.toThrow(/already a folder named "Offertes"/);
	});

	it("restores a deleted document out of a folder that is gone, so the tree still shows it", async () => {
		const { db, acme } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		const doc = await importFile({ source: bytes("Offerte.txt", "Een offerte."), folderId: offers.id }, db);
		await documents.remove(doc.id, db);
		await folders.remove(offers.id, db);
		const restored = await documents.restore(doc.id, db);
		expect(restored).toMatchObject({ clientId: acme.id, folderId: null });
		expect((await documents.listIn({ clientId: acme.id, projectId: null, folderId: null }, db)).map((d) => d.id)).toEqual([
			doc.id,
		]);
	});
});

describe("moving, duplicating, copying and renaming", () => {
	it("moves a document into a folder under another project, relinking it by the owner rule", async () => {
		const { db, other, website, acme } = await setUp();
		const designs = await folders.create({ name: "Ontwerpen", projectId: website.id }, db);
		const doc = await importFile({ source: bytes("Schets.txt", "Een schets."), clientId: other.id }, db);
		const moved = await organise.move(doc.id, { folderId: designs.id }, db);
		expect(moved).toMatchObject({ clientId: acme.id, projectId: website.id, folderId: designs.id });

		// Relinking to another place takes it out of the folder, which belongs to the old place.
		const relinked = await documents.link(doc.id, { clientId: other.id, projectId: null }, db);
		expect(relinked.folderId).toBeNull();

		await expect(organise.move(doc.id, { folderId: designs.id, clientId: other.id }, db)).rejects.toThrow(
			/kept under another client or project/,
		);
	});

	it("lists what sits directly in one node", async () => {
		const { db, acme, website } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		const inFolder = await importFile({ source: bytes("A.txt", "a"), folderId: offers.id }, db);
		const atClient = await importFile({ source: bytes("B.txt", "b"), clientId: acme.id }, db);
		const atProject = await importFile({ source: bytes("C.txt", "c"), projectId: website.id }, db);
		const ids = async (place: { clientId: string | null; projectId: string | null; folderId: string | null }) =>
			(await documents.listIn(place, db)).map((record) => record.id);
		expect(await ids({ clientId: acme.id, projectId: null, folderId: null })).toEqual([atClient.id]);
		expect(await ids({ clientId: acme.id, projectId: website.id, folderId: null })).toEqual([atProject.id]);
		expect(await ids({ clientId: null, projectId: null, folderId: offers.id })).toEqual([inFolder.id]);
	});

	it("duplicates in the same place as '(copy)', copying the file with its extension", async () => {
		const { db, acme } = await setUp();
		const offers = await folders.create({ name: "Offertes", clientId: acme.id }, db);
		const docx = await docxBytes(AGREEMENT);
		const original = await importFile({ source: bytes("Offerte.docx", docx), folderId: offers.id }, db);

		const copy = await organise.duplicate(original.id, db);
		expect(copy).toMatchObject({ title: "Offerte (copy)", clientId: acme.id, folderId: offers.id, versionCount: 1 });
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
		expect(copied).toMatchObject({ title: "Voorwaarden", clientId: other.id, folderId: null });
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
		expect(() => documents.assertSignable({ ...record, isSpecimen: true })).toThrow(/not been reviewed/);
	});
});
