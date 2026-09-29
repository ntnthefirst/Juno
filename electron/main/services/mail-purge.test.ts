/**
 * Purging a removed account: what goes, what stays, and what it refuses.
 * The mail is written the way the sync writes it (rows plus attachment files
 * under a folder per account and message), because a purge is only as good as
 * its picture of where things are.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import {
	clients,
	documents,
	mailAccounts,
	mailAttachments,
	mailFolders,
	mailMessages,
	mailOutbox,
	mailOutboxAttachments,
	mailOutboxClients,
	mailThreads,
} from "../db/schema";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import { MailPurgeError, purge, removedAccounts } from "./mail-purge";
import { storeBody } from "./mail-store";
import { configureMailThreads } from "./mail-threads";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const STAMP = "2026-03-01T10:00:00.000Z";

let db: Db;
let mailDir: string;
let old: string;
let live: string;

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	mailDir = mkdtempSync(join(tmpdir(), "juno-purge-"));
	configureCredentialStore(new MemoryCredentialStore());
	configureSettings(mkdtempSync(join(tmpdir(), "juno-purge-settings-")));
	configureMailThreads(mailDir);

	old = (await accounts.create({ email: "old@example.be", imapHost: "imap.example.be", password: "x" }, db)).id;
	live = (await accounts.create({ email: "live@example.be", imapHost: "imap.example.be", password: "x" }, db)).id;
});

afterEach(() => {
	rmSync(mailDir, { recursive: true, force: true });
});

interface Seeded {
	messageId: string;
	threadId: string;
	outboxId: string;
	attachmentPaths: string[];
}

/** One folder, thread, message with two attachments, and one composed reply. */
function seedMail(accountId: string, tag: string): Seeded {
	const folder = db
		.insert(mailFolders)
		.values({ accountId, path: "INBOX", name: "INBOX", createdAt: STAMP, updatedAt: STAMP })
		.returning()
		.get();
	const thread = db
		.insert(mailThreads)
		.values({
			accountId,
			subject: `Offerte ${tag}`,
			subjectNorm: `offerte ${tag}`,
			firstMessageAt: STAMP,
			lastMessageAt: STAMP,
			createdAt: STAMP,
			updatedAt: STAMP,
		})
		.returning()
		.get();
	const message = db
		.insert(mailMessages)
		.values({
			accountId,
			folderId: folder.id,
			threadId: thread.id,
			uid: 1,
			subject: `Offerte ${tag}`,
			bodyText: `zoekwoord${tag}`,
			internalDate: STAMP,
			createdAt: STAMP,
			updatedAt: STAMP,
		})
		.returning()
		.get();
	storeBody(
		db,
		message.id,
		{
			messageId: null,
			inReplyTo: null,
			references: [],
			subject: "",
			date: null,
			from: null,
			to: [],
			cc: [],
			replyTo: [],
			text: `zoekwoord${tag}`,
			html: null,
			attachments: [
				{ filename: "offerte.pdf", mimeType: "application/pdf", size: 1000, content: Buffer.from("pdf"), contentId: null, isInline: false },
				{ filename: "logo.png", mimeType: "image/png", size: 500, content: Buffer.from("png"), contentId: "logo", isInline: true },
			],
		},
		mailDir,
	);

	const client = db
		.insert(clients)
		.values({ name: `Klant ${tag}`, sortName: `klant ${tag}`, createdAt: STAMP, updatedAt: STAMP })
		.returning()
		.get();
	const document = db
		.insert(documents)
		.values({ clientId: client.id, title: `Contract ${tag}`, bodyHtml: "<p>x</p>", createdAt: STAMP, updatedAt: STAMP })
		.returning()
		.get();
	const outbox = db
		.insert(mailOutbox)
		.values({
			accountId,
			messageId: `<${tag}@example.be>`,
			threadId: thread.id,
			replyToMessageId: message.id,
			clientId: client.id,
			state: "sent",
			createdAt: STAMP,
			updatedAt: STAMP,
		})
		.returning()
		.get();
	db.insert(mailOutboxClients)
		.values({ outboxId: outbox.id, clientId: client.id, matchedAddress: "klant@example.be", createdAt: STAMP, updatedAt: STAMP })
		.run();
	db.insert(mailOutboxAttachments)
		.values({ outboxId: outbox.id, documentId: document.id, filename: "contract.pdf", createdAt: STAMP, updatedAt: STAMP })
		.run();

	const attachmentPaths = db
		.select()
		.from(mailAttachments)
		.where(eq(mailAttachments.messageId, message.id))
		.all()
		.map((row) => join(mailDir, row.filePath));
	return { messageId: message.id, threadId: thread.id, outboxId: outbox.id, attachmentPaths };
}

function rowCounts(accountId: string) {
	const messageIds = db.select({ id: mailMessages.id }).from(mailMessages).where(eq(mailMessages.accountId, accountId)).all();
	return {
		folders: db.select().from(mailFolders).where(eq(mailFolders.accountId, accountId)).all().length,
		threads: db.select().from(mailThreads).where(eq(mailThreads.accountId, accountId)).all().length,
		messages: messageIds.length,
		outbox: db.select().from(mailOutbox).where(eq(mailOutbox.accountId, accountId)).all().length,
		indexed: messageIds.reduce(
			(total, { id }) =>
				total + (db.all<{ n: number }>(sql`select count(*) as n from mail_messages_fts where message_id = ${id}`)[0]?.n ?? 0),
			0,
		),
	};
}

describe("purge", () => {
	it("refuses an account that is still connected", () => {
		seedMail(old, "a");
		expect(() => purge(old, "old@example.be", db)).toThrow(/Remove the account first/);
		expect(() => purge(old, "old@example.be", db)).toThrow(expect.objectContaining({ code: "not-removed" }));
		expect(rowCounts(old).messages).toBe(1);
	});

	it("refuses an account that does not exist", () => {
		expect(() => purge("nope", "x@example.be", db)).toThrow(MailPurgeError);
		expect(() => purge("nope", "x@example.be", db)).toThrow(/does not exist/);
	});

	it("refuses a wrong confirmation address and deletes nothing", async () => {
		const seeded = seedMail(old, "a");
		await accounts.remove(old, db);
		expect(() => purge(old, "other@example.be", db)).toThrow(/does not match/);
		expect(() => purge(old, "", db)).toThrow(MailPurgeError);
		expect(rowCounts(old).messages).toBe(1);
		expect(existsSync(seeded.attachmentPaths[0]!)).toBe(true);
	});

	it("accepts the address in another case with spaces around it", async () => {
		seedMail(old, "a");
		await accounts.remove(old, db);
		expect(purge(old, "  OLD@Example.BE ", db).messages).toBe(1);
	});

	it("removes every row and file of the account and none of another", async () => {
		const gone = seedMail(old, "a");
		const kept = seedMail(live, "b");
		await accounts.remove(old, db);

		const result = purge(old, "old@example.be", db);
		expect(result).toEqual({ messages: 1, attachments: 2, outboxMessages: 1, leftOnDisk: 0 });

		expect(rowCounts(old)).toEqual({ folders: 0, threads: 0, messages: 0, outbox: 0, indexed: 0 });
		expect(db.select().from(mailAttachments).where(eq(mailAttachments.messageId, gone.messageId)).all()).toHaveLength(0);
		expect(db.select().from(mailOutboxClients).where(eq(mailOutboxClients.outboxId, gone.outboxId)).all()).toHaveLength(0);
		expect(
			db.select().from(mailOutboxAttachments).where(eq(mailOutboxAttachments.outboxId, gone.outboxId)).all(),
		).toHaveLength(0);
		for (const path of gone.attachmentPaths) expect(existsSync(path)).toBe(false);
		expect(existsSync(join(mailDir, old))).toBe(false);

		expect(rowCounts(live)).toEqual({ folders: 1, threads: 1, messages: 1, outbox: 1, indexed: 1 });
		expect(db.select().from(mailAttachments).where(eq(mailAttachments.messageId, kept.messageId)).all()).toHaveLength(2);
		expect(db.select().from(mailOutboxClients).where(eq(mailOutboxClients.outboxId, kept.outboxId)).all()).toHaveLength(1);
		for (const path of kept.attachmentPaths) expect(existsSync(path)).toBe(true);

		// The document an outgoing message pointed at is not the purge's to delete.
		expect(db.select().from(documents).all()).toHaveLength(2);
	});

	it("keeps the account row, still removed", async () => {
		seedMail(old, "a");
		await accounts.remove(old, db);
		purge(old, "old@example.be", db);
		const row = db.select().from(mailAccounts).where(eq(mailAccounts.id, old)).get();
		expect(row?.deletedAt).not.toBeNull();
	});

	it("cuts a link from another account's composed message instead of failing", async () => {
		const gone = seedMail(old, "a");
		const other = seedMail(live, "b");
		db.update(mailOutbox)
			.set({ replyToMessageId: gone.messageId, threadId: gone.threadId })
			.where(eq(mailOutbox.id, other.outboxId))
			.run();
		await accounts.remove(old, db);

		purge(old, "old@example.be", db);
		const row = db.select().from(mailOutbox).where(eq(mailOutbox.id, other.outboxId)).get();
		expect(row).toBeDefined();
		expect(row?.replyToMessageId).toBeNull();
		expect(row?.threadId).toBeNull();
	});

	it("removes soft-deleted messages too", async () => {
		const seeded = seedMail(old, "a");
		db.update(mailMessages).set({ deletedAt: STAMP }).where(eq(mailMessages.id, seeded.messageId)).run();
		await accounts.remove(old, db);
		expect(purge(old, "old@example.be", db).messages).toBe(1);
		expect(rowCounts(old).messages).toBe(0);
	});

	it("is safe to run twice, and tolerates files that are already gone", async () => {
		const seeded = seedMail(old, "a");
		rmSync(seeded.attachmentPaths[0]!);
		await accounts.remove(old, db);

		expect(purge(old, "old@example.be", db).leftOnDisk).toBe(0);
		expect(purge(old, "old@example.be", db)).toEqual({ messages: 0, attachments: 0, outboxMessages: 0, leftOnDisk: 0 });
	});

	it("never deletes outside the mail folder", async () => {
		const seeded = seedMail(old, "a");
		const outside = mkdtempSync(join(tmpdir(), "juno-outside-"));
		const victim = join(outside, "keep.txt");
		writeFileSync(victim, "keep");
		const [escaping, whole] = db
			.select()
			.from(mailAttachments)
			.where(eq(mailAttachments.messageId, seeded.messageId))
			.all();
		// One path climbs out of the mail folder, the other names the folder itself.
		db.update(mailAttachments)
			.set({ filePath: relative(mailDir, victim) })
			.where(eq(mailAttachments.id, escaping!.id))
			.run();
		db.update(mailAttachments).set({ filePath: "." }).where(eq(mailAttachments.id, whole!.id)).run();
		await accounts.remove(old, db);

		const result = purge(old, "old@example.be", db);
		expect(existsSync(victim)).toBe(true);
		expect(existsSync(mailDir)).toBe(true);
		expect(result.leftOnDisk).toBe(2);
		rmSync(outside, { recursive: true, force: true });
	});
});

describe("removedAccounts", () => {
	it("lists only removed accounts that still hold mail, with counts", async () => {
		seedMail(old, "a");
		seedMail(live, "b");
		const empty = (await accounts.create({ email: "empty@example.be", imapHost: "imap.example.be", password: "x" }, db)).id;
		await accounts.remove(empty, db);
		expect(removedAccounts(db)).toEqual([]);

		await accounts.remove(old, db);
		expect(removedAccounts(db)).toEqual([
			{
				id: old,
				label: "old@example.be",
				email: "old@example.be",
				removedAt: expect.any(String),
				messages: 1,
				attachments: 2,
				outboxMessages: 1,
				attachmentBytes: 1500,
			},
		]);
	});

	it("drops an account once it is purged", async () => {
		seedMail(old, "a");
		await accounts.remove(old, db);
		expect(removedAccounts(db)).toHaveLength(1);
		purge(old, "old@example.be", db);
		expect(removedAccounts(db)).toEqual([]);
	});
});
