/**
 * Files attached to a mail from this machine: sent and not kept, unless the
 * person asks for one to be kept, and then kept only once the message has gone.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { documentSignatures } from "../db/schema";
import * as clientsService from "./clients";
import { addVersion, importFile } from "./document-import";
import * as documents from "./documents";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import * as outbox from "./mail-outbox";
import * as files from "./mail-outbox-files";
import * as sender from "./mail-send";
import { configureMailTransport, type OutgoingMessage } from "./mail-transport";
import * as projectsService from "./projects";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;
let dir: string;
let outboxDir: string;
let accountId: string;
let sent: OutgoingMessage[];

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	dir = mkdtempSync(join(tmpdir(), "juno-outbox-files-"));
	outboxDir = join(dir, "outbox");
	configureSettings(dir);
	configureCredentialStore(new MemoryCredentialStore());
	documents.configureDocumentStorage(join(dir, "documents"));
	files.configureOutboxFiles(outboxDir);
	sent = [];
	configureMailTransport(
		{
			async verify() {
				return;
			},
			async send(_connection, message) {
				// Read now: the copy is removed once the message has gone.
				sent.push({
					...message,
					attachments: message.attachments.map((a) => ({ ...a, path: readFileSync(a.path, "latin1") })),
				});
				return { raw: Buffer.from("raw"), accepted: message.to.map((a) => a.address), rejected: [] };
			},
		},
		async () => undefined,
	);
	sender.resetForTests();
	const account = await accounts.create(
		{ email: "hallo@juno.test", imapHost: "imap.juno.test", smtpHost: "smtp.juno.test", password: "secret" },
		db,
	);
	accountId = account.id;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

async function draft(input: { clientId?: string | null; projectId?: string | null } = {}) {
	return outbox.createDraft(
		{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Offerte", bodyText: "Hallo.", ...input },
		db,
	);
}

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
/** A file with a PDF header and a marker, enough for the importer, which checks the header. */
const pdf = (marker: string) => bytes(`%PDF-1.4\n% ${marker}\n%%EOF`);

describe("files from this machine", () => {
	it("copies a dropped file onto the draft under a name made of ids, and strips any folder from its name", async () => {
		const message = await draft();
		const after = await files.add(message.id, { fileName: "..\\..\\evil/Offerte.docx", data: bytes("word") }, db);

		expect(after.files).toHaveLength(1);
		expect(after.files[0]).toMatchObject({
			fileName: "Offerte.docx",
			mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			byteSize: 4,
			keepAsDocument: false,
			canKeep: false,
		});
		const stored = readdirSync(join(outboxDir, message.id));
		expect(stored).toEqual([after.files[0]!.id]);
	});

	it("keeps PDFs only: a zip is sent and never kept", async () => {
		const message = await draft();
		const after = await files.add(message.id, { fileName: "photos.zip", data: bytes("zip") }, db);
		expect(after.files[0]!.canKeep).toBe(false);
		await expect(files.setKeep(after.files[0]!.id, true, db)).rejects.toThrow(/not a PDF/);
	});

	it("refuses an empty file, and a file on a message that has gone", async () => {
		const message = await draft();
		await expect(files.add(message.id, { fileName: "a.txt", data: new Uint8Array() }, db)).rejects.toThrow(/empty/);
		await outbox.cancel(message.id, db);
		await expect(files.add(message.id, { fileName: "a.txt", data: bytes("x") }, db)).rejects.toThrow(
			/cannot be changed/,
		);
	});

	it("moves the seal when a file changes, so an approval of the old draft is refused", async () => {
		const message = await draft();
		const review = await outbox.reviewForSend(message.id, db);
		await new Promise((done) => setTimeout(done, 5));
		await files.add(message.id, { fileName: "a.txt", data: bytes("x") }, db);
		await expect(outbox.verifyDraftUnchanged(message.id, review.seal, db)).rejects.toThrow(/changed after/);
		expect((await outbox.reviewForSend(message.id, db)).preview).toContain("Attached: a.txt");
	});

	it("removes a file and its copy", async () => {
		const message = await draft();
		const added = await files.add(message.id, { fileName: "a.txt", data: bytes("x") }, db);
		const after = await files.remove(added.files[0]!.id, db);
		expect(after.files).toEqual([]);
		expect(readdirSync(join(outboxDir, message.id))).toEqual([]);
	});

	it("sends the file, keeps nothing, and removes the copy", async () => {
		const message = await draft();
		await files.add(message.id, { fileName: "Plan.xlsx", data: bytes("sheet") }, db);
		await outbox.requestSend(message.id, db);
		expect(await sender.processQueue(db)).toBe(1);

		expect(sent[0]!.attachments).toEqual([
			{
				filename: "Plan.xlsx",
				path: "sheet",
				contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			},
		]);
		expect(await documents.list({}, db)).toEqual([]);
		expect(readdirSync(join(outboxDir, message.id))).toEqual([]);
		const after = (await outbox.get(message.id, db))!;
		expect(after.state).toBe("sent");
		expect(after.files[0]!.fileName).toBe("Plan.xlsx");
	});

	it("keeps a file marked to keep, only once sent, under the mail's client and project", async () => {
		const client = await clientsService.create({ name: "Acme" }, db);
		const project = await projectsService.create({ name: "Website", clientId: client.id }, db);
		const message = await draft({ clientId: client.id, projectId: project.id });
		const added = await files.add(message.id, { fileName: "Offerte.pdf", data: pdf("v1") }, db);
		expect(added.files[0]!.canKeep).toBe(true);
		await files.setKeep(added.files[0]!.id, true, db);

		// Not before it has gone.
		expect(await documents.list({}, db)).toEqual([]);

		await outbox.requestSend(message.id, db);
		await sender.processQueue(db);

		const kept = await documents.list({}, db);
		expect(kept).toHaveLength(1);
		expect(kept[0]).toMatchObject({
			title: "Offerte",
			clientId: client.id,
			projectId: project.id,
			sourceKind: "imported",
		});
		expect((await outbox.get(message.id, db))!.files[0]!.documentId).toBe(kept[0]!.id);
	});

	it("makes a file named like a kept document its next version, and never keeps the same bytes twice", async () => {
		const client = await clientsService.create({ name: "Acme" }, db);
		for (const content of ["v1", "v2", "v2"]) {
			const message = await draft({ clientId: client.id });
			const added = await files.add(message.id, { fileName: "Offerte.pdf", data: pdf(content) }, db);
			await files.setKeep(added.files[0]!.id, true, db);
			await outbox.requestSend(message.id, db);
			await sender.processQueue(db);
		}
		const kept = await documents.list({ clientId: client.id }, db);
		expect(kept).toHaveLength(1);
		expect(kept[0]!.versionCount).toBe(2);
	});

	it("does not keep a file a draft that was thrown away carried, and prune removes its copy", async () => {
		const message = await draft();
		const added = await files.add(message.id, { fileName: "Offerte.pdf", data: bytes("%PDF-1.4\n%%EOF") }, db);
		await files.setKeep(added.files[0]!.id, true, db);
		await outbox.remove(message.id, db);

		expect(files.prune(db)).toBe(1);
		expect(existsSync(join(outboxDir, message.id, added.files[0]!.id))).toBe(false);
		expect(await documents.list({}, db)).toEqual([]);
	});

	it("refuses to send when the copy has gone missing, rather than sending without it", async () => {
		const message = await draft();
		const added = await files.add(message.id, { fileName: "a.txt", data: bytes("x") }, db);
		rmSync(join(outboxDir, message.id, added.files[0]!.id));
		await outbox.requestSend(message.id, db);
		await sender.processQueue(db);
		const after = (await outbox.get(message.id, db))!;
		expect(after.state).toBe("failed");
		expect(after.lastError).toMatch(/no longer on this machine/);
		expect(sent).toEqual([]);
	});
});

describe("a document attached from Documents", () => {
	it("goes out as its newest version, so a countersigned copy that came back is what is sent", async () => {
		const client = await clientsService.create({ name: "Acme" }, db);
		const record = await importFile(
			{ source: { kind: "bytes", fileName: "Offerte.pdf", data: pdf("ours"), fileDate: "2026-01-01T00:00:00.000Z" }, clientId: client.id },
			db,
		);
		// Signed by us in January: the copy the sender used to prefer whatever came after it.
		const signedPath = join(dir, "ours-signed.pdf");
		writeFileSync(signedPath, "%PDF-1.4\n% signed\n%%EOF");
		db.insert(documentSignatures)
			.values({
				documentId: record.id,
				signerName: "Nathan",
				signedAt: "2026-01-15T00:00:00.000Z",
				documentHash: "x",
				signedPdfPath: signedPath,
			})
			.run();
		await addVersion(
			{
				documentId: record.id,
				source: { kind: "bytes", fileName: "Offerte getekend.pdf", data: pdf("theirs"), fileDate: "2026-02-01T00:00:00.000Z" },
			},
			db,
		);
		const message = await outbox.createDraft(
			{
				accountId,
				to: [{ name: null, address: "laura@obet.be" }],
				subject: "Offerte",
				bodyText: "",
				documentIds: [record.id],
			},
			db,
		);
		await outbox.requestSend(message.id, db);
		await sender.processQueue(db);
		expect(sent[0]!.attachments).toEqual([
			{ filename: "Offerte.pdf", path: "%PDF-1.4\n% theirs\n%%EOF", contentType: "application/pdf" },
		]);
	});
});
