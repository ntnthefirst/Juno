/**
 * Folders: what the sync decides to pull, and the three things a person does to
 * a folder.
 *
 * The behaviour worth holding here is the same order filing keeps. The server
 * changes first: a folder that exists only locally is a folder the next sync
 * deletes, and one deleted only locally comes straight back.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailFolders, mailMessages } from "../db/schema";
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
import { configureMailboxWriter, type MailboxWriter } from "./mail-writer";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

/**
 * A server whose delimiter is "." and which keeps everything under INBOX, the
 * way this project's own account does. Getting the prefix wrong there creates a
 * folder the server hides, so the fixture is that shape on purpose.
 */
class FakeServer {
	folders: RemoteFolder[] = [
		{ path: "INBOX", name: "INBOX", delimiter: ".", specialUse: "inbox" },
		{ path: "INBOX.Sent", name: "Sent", delimiter: ".", specialUse: "sent" },
	];
	messages = new Map<string, { uid: number; subject: string }[]>();
	failWrites: Error | null = null;
	writersOpened = 0;
	writersClosed = 0;
	open = "INBOX";

	source(): MailboxSource {
		return {
			listFolders: async () => this.folders,
			openFolder: async (path) => {
				this.open = path;
				const list = this.messages.get(path) ?? [];
				return {
					uidValidity: "1",
					uidNext: Math.max(0, ...list.map((m) => m.uid)) + 1,
					exists: list.length,
				};
			},
			searchUids: async () => (this.messages.get(this.open) ?? []).map((m) => m.uid),
			fetchHeaders: async (uids): Promise<RemoteHeader[]> =>
				(this.messages.get(this.open) ?? [])
					.filter((m) => uids.includes(m.uid))
					.map((m) => ({
						uid: m.uid,
						flags: [],
						internalDate: new Date().toISOString(),
						size: 10,
						envelope: {
							date: new Date().toISOString(),
							subject: m.subject,
							messageId: `<${m.uid}@x>`,
							inReplyTo: null,
							references: [],
							from: { name: null, address: "a@x.be" },
							to: [],
							cc: [],
							replyTo: [],
						},
						hasAttachments: false,
					})),
			fetchFlags: async () => [],
			fetchSource: async () => null,
			close: async () => undefined,
		};
	}

	writer(): MailboxWriter {
		this.writersOpened += 1;
		return {
			openFolder: async () => {
				if (this.failWrites) throw this.failWrites;
				return { uidValidity: "1" };
			},
			createFolder: async (path) => {
				if (this.failWrites) throw this.failWrites;
				if (this.folders.some((folder) => folder.path === path)) return;
				this.folders.push({
					path,
					name: path.split(".").pop() ?? path,
					delimiter: ".",
					specialUse: null,
				});
			},
			renameFolder: async (path, toPath) => {
				if (this.failWrites) throw this.failWrites;
				// IMAP renames the subtree, and so does this.
				this.folders = this.folders.map((folder) =>
					folder.path === path || folder.path.startsWith(`${path}.`)
						? { ...folder, path: `${toPath}${folder.path.slice(path.length)}` }
						: folder,
				);
			},
			deleteFolder: async (path) => {
				if (this.failWrites) throw this.failWrites;
				this.folders = this.folders.filter((folder) => folder.path !== path);
			},
			setFlags: async () => undefined,
			move: async () => new Map(),
			expunge: async () => undefined,
			close: async () => {
				this.writersClosed += 1;
			},
		};
	}
}

let db: Db;
let server: FakeServer;
let mailDir: string;
let accountId: string;

function pathsOf(list: { path: string }[]): string[] {
	return list.map((folder) => folder.path);
}

beforeEach(async () => {
	db = freshDb();
	server = new FakeServer();
	mailDir = mkdtempSync(join(tmpdir(), "juno-folders-"));
	configureCredentialStore(new MemoryCredentialStore());
	configureSettings(mkdtempSync(join(tmpdir(), "juno-folders-settings-")));
	configureMailboxSource(async () => server.source());
	configureMailboxWriter(async () => server.writer());
	sync.configureMailSync({ mailDir });
	sync.resetForTests();

	const account = await accounts.create(
		{ email: "me@juno.test", imapHost: "imap.juno.test", password: "secret" },
		db,
	);
	accountId = account.id;
	await sync.syncAccount(accountId, db);
});

afterEach(() => {
	rmSync(mailDir, { recursive: true, force: true });
	sync.resetForTests();
});

describe("what gets pulled", () => {
	it("pulls every folder a sync finds", async () => {
		const listed = await folders.list(accountId, db);
		expect(listed.every((folder) => folder.syncEnabled)).toBe(true);
	});

	it("records that a choice was made by hand, so the default cannot override it", async () => {
		const sent = (await folders.list(accountId, db)).find((f) => f.specialUse === "sent")!;
		await folders.setSyncEnabled(sent.id, false, db);

		const row = db.select().from(mailFolders).where(eq(mailFolders.id, sent.id)).get()!;
		expect(row.syncEnabled).toBe(false);
		expect(row.syncChoiceAt).not.toBeNull();
	});
});

describe("making a folder", () => {
	it("puts it where the account's other folders live", async () => {
		// The server keeps everything under INBOX, so a new folder goes there too
		// rather than at a root the server hides.
		const created = await folders.create({ accountId, name: "Facturen" }, db);

		expect(created.path).toBe("INBOX.Facturen");
		expect(pathsOf(server.folders)).toContain("INBOX.Facturen");
		expect(pathsOf(await folders.list(accountId, db))).toContain("INBOX.Facturen");
	});

	it("nests inside the folder it was given", async () => {
		const parent = await folders.create({ accountId, name: "Facturen" }, db);
		const child = await folders.create({ accountId, name: "2026", parentId: parent.id }, db);

		expect(child.path).toBe("INBOX.Facturen.2026");
	});

	it("refuses a name carrying the server's separator", async () => {
		await expect(folders.create({ accountId, name: "Facturen.2026" }, db)).rejects.toThrow(/cannot contain/i);
		await expect(folders.create({ accountId, name: "  " }, db)).rejects.toThrow(/needs a name/i);
	});

	it("refuses a second folder with the same name", async () => {
		await folders.create({ accountId, name: "Facturen" }, db);
		await expect(folders.create({ accountId, name: "Facturen" }, db)).rejects.toThrow(/already has a folder/i);
	});

	it("writes nothing locally when the server refuses", async () => {
		server.failWrites = new Error("connection lost");
		await expect(folders.create({ accountId, name: "Facturen" }, db)).rejects.toThrow();

		expect(pathsOf(await folders.list(accountId, db))).not.toContain("INBOX.Facturen");
		expect(server.writersClosed).toBe(server.writersOpened);
	});
});

describe("renaming a folder", () => {
	it("moves the children's paths with it", async () => {
		const parent = await folders.create({ accountId, name: "Facturen" }, db);
		await folders.create({ accountId, name: "2026", parentId: parent.id }, db);

		await folders.rename(parent.id, "Rekeningen", db);

		expect(pathsOf(await folders.list(accountId, db))).toEqual(
			expect.arrayContaining(["INBOX.Rekeningen", "INBOX.Rekeningen.2026"]),
		);
		expect(pathsOf(server.folders)).toEqual(
			expect.arrayContaining(["INBOX.Rekeningen", "INBOX.Rekeningen.2026"]),
		);
	});

	it("refuses a folder the account needs", async () => {
		const sent = (await folders.list(accountId, db)).find((f) => f.specialUse === "sent")!;
		await expect(folders.rename(sent.id, "Verzonden", db)).rejects.toThrow(/the server's/i);
	});
});

describe("removing a folder", () => {
	it("takes the folder and its messages off the server and out of the list", async () => {
		const created = await folders.create({ accountId, name: "Facturen" }, db);
		server.messages.set("INBOX.Facturen", [{ uid: 1, subject: "one" }]);
		await sync.syncAccount(accountId, db);
		const before = db
			.select({ id: mailMessages.id })
			.from(mailMessages)
			.where(and(eq(mailMessages.folderId, created.id), isNull(mailMessages.deletedAt)))
			.all();
		expect(before).toHaveLength(1);

		await folders.remove(created.id, db);

		expect(pathsOf(server.folders)).not.toContain("INBOX.Facturen");
		expect(pathsOf(await folders.list(accountId, db))).not.toContain("INBOX.Facturen");
		expect(
			db
				.select({ id: mailMessages.id })
				.from(mailMessages)
				.where(and(eq(mailMessages.folderId, created.id), isNull(mailMessages.deletedAt)))
				.all(),
		).toHaveLength(0);
	});

	it("refuses a folder with folders inside it, and one the account needs", async () => {
		const parent = await folders.create({ accountId, name: "Facturen" }, db);
		await folders.create({ accountId, name: "2026", parentId: parent.id }, db);
		await expect(folders.remove(parent.id, db)).rejects.toThrow(/inside it/i);

		const sent = (await folders.list(accountId, db)).find((f) => f.specialUse === "sent")!;
		await expect(folders.remove(sent.id, db)).rejects.toThrow(/cannot be removed/i);
	});

	it("leaves the local rows alone when the server refuses", async () => {
		const created = await folders.create({ accountId, name: "Facturen" }, db);
		server.failWrites = new Error("connection lost");

		await expect(folders.remove(created.id, db)).rejects.toThrow();
		expect(pathsOf(await folders.list(accountId, db))).toContain("INBOX.Facturen");
	});
});

describe("a folder Juno needs and the server lacks", () => {
	it("makes it under the same prefix as the rest", async () => {
		const archive = await folders.ensureSpecialFolder(accountId, "archive", db);

		expect(archive.path).toBe("INBOX.Archive");
		expect(archive.specialUse).toBe("archive");
		expect(pathsOf(server.folders)).toContain("INBOX.Archive");
	});

	it("hands back the one that is already there rather than making a second", async () => {
		const first = await folders.ensureSpecialFolder(accountId, "sent", db);
		const again = await folders.ensureSpecialFolder(accountId, "sent", db);

		expect(again.id).toBe(first.id);
		expect(server.folders.filter((folder) => folder.path === "INBOX.Sent")).toHaveLength(1);
	});
});
