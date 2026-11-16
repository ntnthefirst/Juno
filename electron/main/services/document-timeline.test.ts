import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailFolders, mailMessages, mailOutbox, mailOutboxAttachments, mailThreads } from "../db/schema";
import * as clients from "./clients";
import { importPath } from "./document-import";
import { timeline } from "./document-timeline";
import * as versions from "./document-versions";
import { configureDocumentStorage } from "./documents";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

async function importedDocument(db: Db) {
	const storage = mkdtempSync(join(tmpdir(), "juno-timeline-storage-"));
	configureDocumentStorage(storage);
	const source = join(mkdtempSync(join(tmpdir(), "juno-timeline-source-")), "source.pdf");
	writeFileSync(source, "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< >>\nendobj\n%%EOF");
	const client = await clients.create({ name: "Acme" }, db);
	return importPath({ sourcePath: source, clientId: client.id }, db);
}

describe("document timeline", () => {
	it("lists each version, newest first, with who signed it", async () => {
		const db = freshDb();
		const record = await importedDocument(db);
		versions.record(
			{
				documentId: record.id,
				kind: "stamped",
				source: "sign",
				pdfPath: record.pdfPath!,
				fileDate: "2099-01-01T00:00:00.000Z",
			},
			db,
		);

		const entries = await timeline(record.id, db);
		expect(entries.map((entry) => entry.kind)).toEqual(["stamped", "imported"]);
		expect(entries[0]!.versionId).not.toBeNull();
		// importPath is the agent's route in, which is how the version is recorded.
		expect(entries[1]!.detail).toBe("Added by the agent, source.pdf");
	});

	it("shows a message that left, and leaves out a draft", async () => {
		const db = freshDb();
		configureSettings(mkdtempSync(join(tmpdir(), "juno-timeline-settings-")));
		configureCredentialStore(new MemoryCredentialStore());
		const record = await importedDocument(db);
		const account = await accounts.create(
			{ email: "hallo@juno.test", imapHost: "imap.juno.test", smtpHost: "smtp.juno.test", password: "secret" },
			db,
		);

		const mail = (state: string, sentAt: string | null, messageId: string) => {
			const [row] = db
				.insert(mailOutbox)
				.values({
					accountId: account.id,
					state,
					toJson: JSON.stringify([{ name: "Laura", address: "laura@obet.be" }]),
					subject: "Contract",
					messageId,
					sentAt,
					queuedAt: sentAt,
				})
				.returning()
				.all();
			db.insert(mailOutboxAttachments)
				.values({ outboxId: row!.id, documentId: record.id, filename: "contract.pdf" })
				.run();
		};
		mail("sent", "2099-02-01T10:00:00.000Z", "<a@juno.test>");
		mail("draft", null, "<b@juno.test>");

		const entries = await timeline(record.id, db);
		const emailed = entries.filter((entry) => entry.kind === "emailed");
		expect(emailed).toHaveLength(1);
		expect(emailed[0]!.title).toBe("Sent by email to Laura");
		expect(entries[0]!.kind).toBe("emailed");
		// No copy in Sent yet, so there is no conversation to open.
		expect(emailed[0]!.threadId).toBeNull();
	});

	it("points a message that left at the conversation its copy in Sent is in", async () => {
		const db = freshDb();
		configureSettings(mkdtempSync(join(tmpdir(), "juno-timeline-settings-")));
		configureCredentialStore(new MemoryCredentialStore());
		const record = await importedDocument(db);
		const account = await accounts.create(
			{ email: "hallo@juno.test", imapHost: "imap.juno.test", smtpHost: "smtp.juno.test", password: "secret" },
			db,
		);
		const folder = db
			.insert(mailFolders)
			.values({ accountId: account.id, path: "Sent", name: "Sent", specialUse: "sent", syncEnabled: true })
			.returning({ id: mailFolders.id })
			.get();
		const thread = db
			.insert(mailThreads)
			.values({ accountId: account.id, subject: "Contract", subjectNorm: "contract", firstMessageAt: "2099-02-01T10:00:00.000Z", lastMessageAt: "2099-02-01T10:00:00.000Z" })
			.returning({ id: mailThreads.id })
			.get();
		db.insert(mailMessages)
			.values({ accountId: account.id, folderId: folder.id, threadId: thread.id, uid: 1, messageId: "<c@juno.test>", subject: "Contract", internalDate: "2099-02-01T10:00:00.000Z" })
			.run();
		const [row] = db
			.insert(mailOutbox)
			.values({ accountId: account.id, state: "sent", toJson: "[]", subject: "Contract", messageId: "<c@juno.test>", sentAt: "2099-02-01T10:00:00.000Z" })
			.returning()
			.all();
		db.insert(mailOutboxAttachments).values({ outboxId: row!.id, documentId: record.id, filename: "contract.pdf" }).run();

		const entries = await timeline(record.id, db);
		expect(entries.find((entry) => entry.kind === "emailed")?.threadId).toBe(thread.id);
		expect(entries.filter((entry) => entry.kind !== "emailed").every((entry) => entry.threadId === null)).toBe(true);
	});

	it("refuses a document that is gone", async () => {
		const db = freshDb();
		await expect(timeline("missing", db)).rejects.toThrow(/no longer exists/);
	});
});
