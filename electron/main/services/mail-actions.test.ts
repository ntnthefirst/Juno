/**
 * Filing mail, against a fake mailbox that can be told to fail.
 *
 * The behaviour worth holding here is the order: the server changes first and
 * the local rows second. A test that only checked the local rows would pass
 * just as happily against the version of this that lied, filtered the list in
 * the renderer, and let the next sync put everything back.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailFolders, mailMessages, mailThreads } from "../db/schema";
import * as actions from "./mail-actions";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import * as folders from "./mail-folders";
import {
	configureMailboxSource,
	type MailboxSource,
	type RemoteFolder,
	type RemoteHeader,
} from "./mail-source";
import * as sync from "./mail-sync";
import * as threads from "./mail-threads";
import { configureMailboxWriter, type MailboxWriter } from "./mail-writer";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

type FakeMessage = {
	uid: number;
	from: string;
	subject: string;
	messageId: string;
	date: string;
	flags: string[];
};

const REMOTE_FOLDERS: RemoteFolder[] = [
	{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" },
	{ path: "Archive", name: "Archive", delimiter: "/", specialUse: "archive" },
	{ path: "Trash", name: "Trash", delimiter: "/", specialUse: "trash" },
];

/** A mailbox both the reader and the writer act on, so a move is visible to both. */
class FakeMailbox {
	messages = new Map<string, FakeMessage[]>([
		["INBOX", []],
		["Archive", []],
		["Trash", []],
	]);
	uidValidity = new Map<string, string>([
		["INBOX", "1"],
		["Archive", "1"],
		["Trash", "1"],
	]);
	/** Writers opened and closed, so a leaked connection fails a test. */
	writersOpened = 0;
	writersClosed = 0;
	/** Set to make every write fail, the way an unreachable server does. */
	failWrites: Error | null = null;
	/** Whether the server answers a MOVE with COPYUID. Both halves are real. */
	reportsNewUids = true;
	nextUid = 900;
	open = "INBOX";

	sourceOf(message: FakeMessage): Buffer {
		return Buffer.from(
			[
				`From: ${message.from}`,
				"To: me@juno.test",
				`Subject: ${message.subject}`,
				`Message-ID: ${message.messageId}`,
				`Date: ${new Date(message.date).toUTCString()}`,
				"MIME-Version: 1.0",
				'Content-Type: text/plain; charset="utf-8"',
				"",
				"Body.",
			].join("\r\n"),
		);
	}

	source(): MailboxSource {
		return sourceOver(this);
	}

	writer(): MailboxWriter {
		return writerOver(this);
	}
}

function sourceOver(box: FakeMailbox): MailboxSource {
	return {
		async listFolders() {
			return REMOTE_FOLDERS;
		},
		async openFolder(path) {
			box.open = path;
			const list = box.messages.get(path) ?? [];
			return {
				uidValidity: box.uidValidity.get(path) ?? "1",
				uidNext: Math.max(0, ...list.map((m) => m.uid)) + 1,
				exists: list.length,
			};
		},
		async searchUids() {
			return (box.messages.get(box.open) ?? []).map((m) => m.uid).sort((a, b) => a - b);
		},
		async fetchHeaders(uids) {
			const out: RemoteHeader[] = [];
			for (const m of box.messages.get(box.open) ?? []) {
				if (!uids.includes(m.uid)) continue;
				out.push({
					uid: m.uid,
					flags: m.flags,
					internalDate: m.date,
					size: 100,
					envelope: {
						date: m.date,
						subject: m.subject,
						messageId: m.messageId,
						inReplyTo: null,
						references: [],
						from: { name: null, address: m.from },
						to: [{ name: null, address: "me@juno.test" }],
						cc: [],
						replyTo: [],
					},
					hasAttachments: false,
				});
			}
			return out;
		},
		async fetchFlags(uids) {
			return (box.messages.get(box.open) ?? [])
				.filter((m) => uids.includes(m.uid))
				.map((m) => ({ uid: m.uid, flags: m.flags }));
		},
		async fetchSource(uid) {
			const m = (box.messages.get(box.open) ?? []).find((x) => x.uid === uid);
			return m ? box.sourceOf(m) : null;
		},
		async close() {},
	};
}

function writerOver(box: FakeMailbox): MailboxWriter {
	let open = "INBOX";
	box.writersOpened += 1;
	return {
		async openFolder(path) {
			if (box.failWrites) throw box.failWrites;
			open = path;
			return { uidValidity: box.uidValidity.get(path) ?? "1" };
		},
		async setFlags(uids, add, remove) {
			if (box.failWrites) throw box.failWrites;
			for (const message of box.messages.get(open) ?? []) {
				if (!uids.includes(message.uid)) continue;
				const set = new Set(message.flags);
				for (const flag of add) set.add(flag);
				for (const flag of remove) set.delete(flag);
				message.flags = [...set];
			}
		},
		async move(uids, toPath) {
			if (box.failWrites) throw box.failWrites;
			const from = box.messages.get(open) ?? [];
			const to = box.messages.get(toPath) ?? [];
			const map = new Map<number, number>();
			for (const uid of uids) {
				const found = from.find((m) => m.uid === uid);
				if (!found) continue;
				const landed = box.nextUid++;
				to.push({ ...found, uid: landed });
				map.set(uid, landed);
			}
			box.messages.set(
				open,
				from.filter((m) => !uids.includes(m.uid)),
			);
			return box.reportsNewUids ? map : new Map();
		},
		async expunge(uids) {
			if (box.failWrites) throw box.failWrites;
			box.messages.set(open, (box.messages.get(open) ?? []).filter((m) => !uids.includes(m.uid)));
		},
		async close() {
			box.writersClosed += 1;
		},
	};
}

let db: Db;
let box: FakeMailbox;
let mailDir: string;
let accountId: string;

/** The one thread that every test starts from, synced in from the fake INBOX. */
async function syncedThread(): Promise<{ threadId: string; messageId: string }> {
	const list = await threads.listThreads({ accountId }, db);
	const summary = list[0];
	if (!summary) throw new Error("the fixture synced no threads");
	const thread = await threads.getThread(summary.id, db);
	const message = thread?.messages[0];
	if (!message) throw new Error("the fixture synced no messages");
	return { threadId: summary.id, messageId: message.id };
}

function folderIdOf(specialUse: string): string {
	const row = db
		.select({ id: mailFolders.id })
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), eq(mailFolders.specialUse, specialUse)))
		.get();
	if (!row) throw new Error(`no ${specialUse} folder`);
	return row.id;
}

function liveMessage(id: string) {
	return db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.id, id), isNull(mailMessages.deletedAt)))
		.get();
}

beforeEach(async () => {
	db = freshDb();
	box = new FakeMailbox();
	mailDir = mkdtempSync(join(tmpdir(), "juno-file-"));
	configureCredentialStore(new MemoryCredentialStore());
	configureSettings(mkdtempSync(join(tmpdir(), "juno-file-settings-")));
	configureMailboxSource(async () => box.source());
	configureMailboxWriter(async () => box.writer());
	sync.configureMailSync({ mailDir });
	threads.configureMailThreads(mailDir);
	sync.resetForTests();

	const account = await accounts.create(
		{ email: "me@juno.test", imapHost: "imap.juno.test", password: "secret", horizonDays: 3650 },
		db,
	);
	accountId = account.id;

	box.messages.get("INBOX")!.push({
		uid: 11,
		from: "jansen@example.be",
		subject: "The roof",
		messageId: "<a@example.be>",
		date: new Date().toISOString(),
		flags: [],
	});
	await sync.syncAccount(accountId, db);
});

afterEach(() => {
	rmSync(mailDir, { recursive: true, force: true });
});

describe("archiving", () => {
	it("moves the message on the server and follows it locally", async () => {
		const { threadId, messageId } = await syncedThread();

		const result = await actions.archiveThreads([threadId], db);

		expect(result.moved).toBe(1);
		expect(result.folderName).toBe("Archive");
		expect(box.messages.get("INBOX")).toHaveLength(0);
		expect(box.messages.get("Archive")).toHaveLength(1);

		// The server said where it landed, so the row went with it.
		expect(result.remembered).toBe(1);
		expect(liveMessage(messageId)?.folderId).toBe(folderIdOf("archive"));
	});

	it("forgets the row when the server does not say where it landed", async () => {
		box.reportsNewUids = false;
		const { threadId, messageId } = await syncedThread();

		const result = await actions.archiveThreads([threadId], db);

		expect(result.moved).toBe(1);
		expect(result.remembered).toBe(0);
		expect(box.messages.get("Archive")).toHaveLength(1);
		// Gone from here rather than pointing at a uid Juno cannot know. The next
		// sync of Archive finds it again.
		expect(liveMessage(messageId)).toBeUndefined();
	});

	it("says which folder is missing rather than inventing one", async () => {
		db.update(mailFolders)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(mailFolders.id, folderIdOf("archive")))
			.run();
		const { threadId } = await syncedThread();

		await expect(actions.archiveThreads([threadId], db)).rejects.toThrow(/no archive folder/i);
	});

	it("leaves the local rows alone when the server refuses", async () => {
		box.failWrites = new Error("connection lost");
		const { threadId, messageId } = await syncedThread();

		await expect(actions.archiveThreads([threadId], db)).rejects.toThrow();

		expect(box.messages.get("INBOX")).toHaveLength(1);
		expect(liveMessage(messageId)?.folderId).toBe(folderIdOf("inbox"));
	});

	it("closes the connection whether it worked or not", async () => {
		const { threadId } = await syncedThread();
		await actions.archiveThreads([threadId], db);
		box.failWrites = new Error("connection lost");
		await expect(actions.trashThreads([threadId], db)).rejects.toThrow();

		expect(box.writersClosed).toBe(box.writersOpened);
	});
});

describe("deleting for good", () => {
	it("expunges on the server and forgets the thread here", async () => {
		const { threadId, messageId } = await syncedThread();

		const removed = await actions.deleteThreadsForever([threadId], db);

		expect(removed).toBe(1);
		expect(box.messages.get("INBOX")).toHaveLength(0);
		expect(liveMessage(messageId)).toBeUndefined();
		// A thread with nothing left in it is not a thread.
		const thread = db
			.select({ deletedAt: mailThreads.deletedAt })
			.from(mailThreads)
			.where(eq(mailThreads.id, threadId))
			.get();
		expect(thread?.deletedAt).not.toBeNull();
	});

	it("keeps the message when the server refuses", async () => {
		box.failWrites = new Error("connection lost");
		const { threadId, messageId } = await syncedThread();

		await expect(actions.deleteThreadsForever([threadId], db)).rejects.toThrow();

		expect(box.messages.get("INBOX")).toHaveLength(1);
		expect(liveMessage(messageId)).toBeDefined();
	});
});

describe("flags", () => {
	it("writes the read flag to the server as well as here", async () => {
		const { messageId } = await syncedThread();

		await actions.setSeen([messageId], true, db);

		expect(box.messages.get("INBOX")![0]!.flags).toContain("\\Seen");
		expect(liveMessage(messageId)?.isSeen).toBe(true);

		await actions.setSeen([messageId], false, db);

		expect(box.messages.get("INBOX")![0]!.flags).not.toContain("\\Seen");
		expect(liveMessage(messageId)?.isSeen).toBe(false);
	});

	it("refuses to act on a folder the server has renumbered", async () => {
		const { messageId } = await syncedThread();
		box.uidValidity.set("INBOX", "2");

		await expect(actions.setSeen([messageId], true, db)).rejects.toThrow(/renumbered/i);
		expect(box.messages.get("INBOX")![0]!.flags).not.toContain("\\Seen");
	});
});

describe("moving to a named folder", () => {
	it("refuses a folder belonging to another account", async () => {
		const other = await accounts.create(
			{ email: "other@juno.test", imapHost: "imap.juno.test", password: "secret" },
			db,
		);
		const strayFolder = db
			.insert(mailFolders)
			.values({ accountId: other.id, path: "Elsewhere", name: "Elsewhere" })
			.returning()
			.all()[0]!;
		const { threadId } = await syncedThread();

		await expect(
			actions.moveThreads([threadId], { folderId: strayFolder.id }, db),
		).rejects.toThrow(/different account/i);
	});

	it("does nothing when the messages are already there", async () => {
		const { threadId } = await syncedThread();
		await actions.archiveThreads([threadId], db);
		const before = box.messages.get("Archive")!.length;

		const result = await actions.moveThreads([threadId], { specialUse: "archive" }, db);

		expect(result.moved).toBe(0);
		expect(box.messages.get("Archive")).toHaveLength(before);
	});
});

// Not exercised here and worth saying out loud: folders.setSyncEnabled is what
// makes Archive and Trash appear in the reader after a move. A move to a folder
// that is not synced is still a real move on the server; the message simply is
// not pulled back until that folder is turned on.
void folders;
