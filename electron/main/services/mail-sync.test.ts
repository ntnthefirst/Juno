/**
 * The sync engine against a fake mailbox. This is where the resume, the
 * UIDVALIDITY reset, deletion detection, threading and client linking are
 * proven, because none of it can be proven against a real server on a schedule.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientEmailsService from "./client-emails";
import * as clientsService from "./clients";
import * as contactsService from "./contacts";
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
import { configureSettings } from "./settings";
import * as threads from "./mail-threads";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

interface FakeMessage {
	uid: number;
	from: string;
	fromName?: string;
	to?: string[];
	subject: string;
	messageId: string;
	inReplyTo?: string;
	references?: string[];
	date: string;
	flags?: string[];
	text?: string;
	html?: string;
}

/**
 * A mailbox in memory. Messages are turned into RFC 822 sources on demand so
 * the real parser runs on the way in.
 */
class FakeMailbox {
	folders: RemoteFolder[] = [{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" }];
	messages = new Map<string, FakeMessage[]>([["INBOX", []]]);
	uidValidity = new Map<string, string>([["INBOX", "1"]]);
	calls: string[] = [];
	closed = 0;
	failConnect: Error | null = null;
	failSource = new Set<number>();
	open = "INBOX";

	add(folder: string, message: FakeMessage): void {
		this.messages.get(folder)!.push(message);
	}

	remove(folder: string, uid: number): void {
		const list = this.messages.get(folder)!;
		this.messages.set(folder, list.filter((m) => m.uid !== uid));
	}

	sourceOf(message: FakeMessage): Buffer {
		const lines = [
			`From: ${message.fromName ? `"${message.fromName}" <${message.from}>` : message.from}`,
			`To: ${(message.to ?? ["me@juno.test"]).join(", ")}`,
			`Subject: ${message.subject}`,
			`Message-ID: ${message.messageId}`,
			`Date: ${new Date(message.date).toUTCString()}`,
			...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
			...(message.references ? [`References: ${message.references.join(" ")}`] : []),
			"MIME-Version: 1.0",
		];
		if (message.html) {
			lines.push('Content-Type: text/html; charset="utf-8"', "", message.html);
		} else {
			lines.push('Content-Type: text/plain; charset="utf-8"', "", message.text ?? "");
		}
		return Buffer.from(lines.join("\r\n"));
	}

	source(): MailboxSource {
		return sourceOver(this);
	}
}

function sourceOver(box: FakeMailbox): MailboxSource {
	return {
		async listFolders() {
			box.calls.push("list");
			return box.folders;
		},
		async openFolder(path) {
			box.calls.push(`open:${path}`);
			box.open = path;
			const list = box.messages.get(path) ?? [];
			return {
				uidValidity: box.uidValidity.get(path) ?? "1",
				uidNext: Math.max(0, ...list.map((m) => m.uid)) + 1,
				exists: list.length,
			};
		},
		async searchUids(query) {
			box.calls.push(`search:${JSON.stringify(query)}`);
			const list = box.messages.get(box.open) ?? [];
			const found = new Set<number>();
			for (const m of list) {
				if (query.since && m.date.slice(0, 10) >= query.since) found.add(m.uid);
				if (query.uidFrom !== undefined && m.uid >= query.uidFrom) found.add(m.uid);
			}
			return [...found].sort((a, b) => a - b);
		},
		async fetchHeaders(uids) {
			box.calls.push(`headers:${uids.length}`);
			const list = box.messages.get(box.open) ?? [];
			const out: RemoteHeader[] = [];
			for (const m of list) {
				if (!uids.includes(m.uid)) continue;
				out.push({
					uid: m.uid,
					flags: m.flags ?? [],
					internalDate: m.date,
					size: 100,
					envelope: {
						date: m.date,
						subject: m.subject,
						messageId: m.messageId,
						inReplyTo: m.inReplyTo ?? null,
						references: m.references ?? [],
						from: { name: m.fromName ?? null, address: m.from },
						to: (m.to ?? ["me@juno.test"]).map((address) => ({ name: null, address })),
						cc: [],
						replyTo: [],
					},
					hasAttachments: false,
				});
			}
			return out;
		},
		async fetchFlags(uids) {
			box.calls.push(`flags:${uids.length}`);
			const list = box.messages.get(box.open) ?? [];
			return list.filter((m) => uids.includes(m.uid)).map((m) => ({ uid: m.uid, flags: m.flags ?? [] }));
		},
		async fetchSource(uid) {
			box.calls.push(`source:${uid}`);
			if (box.failSource.has(uid)) throw new Error("boom");
			const m = (box.messages.get(box.open) ?? []).find((x) => x.uid === uid);
			return m ? box.sourceOf(m) : null;
		},
		async close() {
			box.closed += 1;
		},
	};
}

let db: Db;
let box: FakeMailbox;
let mailDir: string;
let accountId: string;

beforeEach(async () => {
	db = freshDb();
	box = new FakeMailbox();
	mailDir = mkdtempSync(join(tmpdir(), "juno-mail-"));
	configureCredentialStore(new MemoryCredentialStore());
	// Adding an account records its address on the owner profile, which lives in
	// settings.json, so this test needs a settings file of its own.
	configureSettings(mkdtempSync(join(tmpdir(), "juno-mail-settings-")));
	configureMailboxSource(async (connection) => {
		if (box.failConnect) throw box.failConnect;
		if (connection.password !== "secret") {
			throw Object.assign(new Error("no"), { authenticationFailed: true });
		}
		return box.source();
	});
	sync.configureMailSync({ mailDir });
	threads.configureMailThreads(mailDir);
	sync.resetForTests();

	const account = await accounts.create(
		{ email: "me@juno.test", imapHost: "imap.juno.test", password: "secret", horizonDays: 30 },
		db,
	);
	accountId = account.id;
});

afterEach(() => {
	rmSync(mailDir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

describe("accounts", () => {
	it("never returns the password, and stores it under a key the row references", async () => {
		const account = (await accounts.get(accountId, db))!;
		expect(JSON.stringify(account)).not.toContain("secret");
		expect(account.hasCredential).toBe(true);
		expect(accounts.connectionFor(accountId, db).password).toBe("secret");
	});

	it("forgets the password on remove", async () => {
		await accounts.remove(accountId, db);
		expect(await accounts.get(accountId, db)).toBeNull();
		expect(() => accounts.connectionFor(accountId, db)).toThrow(/does not exist/);
	});

	it("refuses a cleartext security setting", async () => {
		await expect(
			accounts.create(
				{ email: "a@b.be", imapHost: "h.be", password: "x", imapSecurity: "plain" as never },
				db,
			),
		).rejects.toThrow(/never connects in the clear/);
	});

	it("tests a connection without storing anything", async () => {
		const ok = await accounts.test({ imapHost: "imap.juno.test", username: "me", password: "secret" }, db);
		expect(ok).toEqual({ ok: true, message: null, folderCount: 1 });
		const bad = await accounts.test({ imapHost: "imap.juno.test", username: "me", password: "wrong" }, db);
		expect(bad.ok).toBe(false);
		expect(bad.message).toMatch(/password for me was rejected/);
		expect(box.closed).toBe(1);
	});
});

describe("sync", () => {
	it("pulls headers then bodies, and threads by Message-ID", async () => {
		box.add("INBOX", {
			uid: 1, from: "laura@obet.be", fromName: "Laura", subject: "Offerte", messageId: "<a@obet>",
			date: recent(3), text: "Hallo, hierbij de offerte.\n> quoted\n-- \nLaura",
		});
		box.add("INBOX", {
			uid: 2, from: "me@juno.test", subject: "Re: Offerte", messageId: "<b@juno>",
			inReplyTo: "<a@obet>", references: ["<a@obet>"], date: recent(2), text: "Bedankt.", flags: ["\\Seen"],
		});
		box.add("INBOX", {
			uid: 3, from: "info@noir.be", subject: "Iets anders", messageId: "<c@noir>", date: recent(1),
			html: "<p>Hallo <b>daar</b></p>",
		});

		const result = await sync.syncAccount(accountId, db);
		expect(result.phase).toBe("done");
		expect(result.newMessages).toBe(3);
		expect(result.fetchedBodies).toBe(3);
		expect(box.closed).toBe(1);

		const list = await threads.listThreads({ accountId }, db);
		expect(list).toHaveLength(2);
		expect(list[0]!.subject).toBe("Iets anders");
		expect(list[1]!.subject).toBe("Offerte");
		expect(list[1]!.messageCount).toBe(2);
		expect(list[1]!.unreadCount).toBe(1);
		// The account's own address is not a participant.
		expect(list[1]!.participants.map((p) => p.address)).toEqual(["laura@obet.be"]);
		expect(list[1]!.snippet).toBe("Bedankt.");

		const thread = (await threads.getThread(list[1]!.id, db))!;
		expect(thread.messages.map((m) => m.uid)).toEqual([1, 2]);
		expect(thread.messages[0]!.snippet).toBe("Hallo, hierbij de offerte.");
		expect(thread.messages[0]!.bodyFetched).toBe(true);

		const body = (await threads.getBody(thread.messages[0]!.id, db))!;
		expect(body.hasHtml).toBe(false);
		expect(body.text).toContain("hierbij de offerte");

		const htmlThread = (await threads.getThread(list[0]!.id, db))!;
		const rendered = threads.renderBody(htmlThread.messages[0]!.id, {}, db)!;
		expect(rendered.document).toContain("<b>daar</b>");
		expect(rendered.document).toContain("Content-Security-Policy");

		const inbox = (await folders.list(accountId, db))[0]!;
		expect(inbox.messageCount).toBe(3);
		expect(inbox.unreadCount).toBe(2);
	});

	it("only fetches what is new on the second run", async () => {
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		await sync.syncAccount(accountId, db);
		box.calls = [];

		box.add("INBOX", { uid: 2, from: "a@x.be", subject: "two", messageId: "<2@x>", date: recent(1), text: "2" });
		const second = await sync.syncAccount(accountId, db);
		expect(second.newMessages).toBe(1);
		expect(box.calls.filter((c) => c.startsWith("headers:"))).toEqual(["headers:1"]);
		expect(box.calls.filter((c) => c.startsWith("source:"))).toEqual(["source:2"]);
		// The listing did not go back to the horizon, only from the oldest local UID.
		expect(box.calls.find((c) => c.startsWith("search:"))).toBe('search:{"uidFrom":1}');
	});

	it("re-lists from the horizon when the horizon is raised", async () => {
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "old", messageId: "<1@x>", date: recent(60), text: "old" });
		box.add("INBOX", { uid: 2, from: "a@x.be", subject: "new", messageId: "<2@x>", date: recent(1), text: "new" });
		await sync.syncAccount(accountId, db);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(1);

		await accounts.update(accountId, { horizonDays: 90 }, db);
		await sync.syncAccount(accountId, db);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(2);
	});

	it("pulls the newest mail anyway when everything predates the horizon", async () => {
		// horizonDays is 30 from beforeEach. A mailbox whose only mail is older
		// than that must not come back looking empty on the first sync.
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "ancient", messageId: "<1@x>", date: recent(400), text: "1" });
		box.add("INBOX", { uid: 2, from: "a@x.be", subject: "older", messageId: "<2@x>", date: recent(200), text: "2" });

		const result = await sync.syncAccount(accountId, db);
		expect(result.newMessages).toBe(2);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(2);

		// A folder that is genuinely empty stays empty: the fallback only fires
		// when the server says there is mail and the horizon search missed it.
		box.remove("INBOX", 1);
		box.remove("INBOX", 2);
		box.uidValidity.set("INBOX", "2");
		const second = await sync.syncAccount(accountId, db);
		expect(second.newMessages).toBe(0);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(0);
	});

	it("soft-deletes what the server no longer has", async () => {
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		box.add("INBOX", { uid: 2, from: "a@x.be", subject: "two", messageId: "<2@x>", date: recent(1), text: "2" });
		await sync.syncAccount(accountId, db);
		box.remove("INBOX", 1);
		await sync.syncAccount(accountId, db);

		const list = await threads.listThreads({ accountId }, db);
		expect(list.map((t) => t.subject)).toEqual(["two"]);
	});

	it("starts a folder over when UIDVALIDITY changes", async () => {
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		await sync.syncAccount(accountId, db);

		// The server renumbered: the same message is now UID 7.
		box.uidValidity.set("INBOX", "2");
		box.remove("INBOX", 1);
		box.add("INBOX", { uid: 7, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		const result = await sync.syncAccount(accountId, db);
		expect(result.newMessages).toBe(1);

		const list = await threads.listThreads({ accountId }, db);
		expect(list).toHaveLength(1);
		const thread = (await threads.getThread(list[0]!.id, db))!;
		expect(thread.messages.map((m) => m.uid)).toEqual([7]);
	});

	it("keeps flags in step", async () => {
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		await sync.syncAccount(accountId, db);
		box.messages.get("INBOX")![0]!.flags = ["\\Seen", "\\Flagged"];
		await sync.syncAccount(accountId, db);

		const list = await threads.listThreads({ accountId }, db);
		expect(list[0]!.unreadCount).toBe(0);
		const thread = (await threads.getThread(list[0]!.id, db))!;
		expect(thread.messages[0]!.isFlagged).toBe(true);
	});

	it("records a body that cannot be read and does not retry it forever", async () => {
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		box.failSource.add(1);
		const first = await sync.syncAccount(accountId, db);
		expect(first.phase).toBe("done");
		expect(first.fetchedBodies).toBe(0);

		box.calls = [];
		await sync.syncAccount(accountId, db);
		expect(box.calls.filter((c) => c.startsWith("source:"))).toEqual([]);

		const list = await threads.listThreads({ accountId }, db);
		const thread = (await threads.getThread(list[0]!.id, db))!;
		expect(thread.messages[0]!.bodyError).toBe("boom");
	});

	it("reports a failed connection in words and records it on the account", async () => {
		box.failConnect = Object.assign(new Error("x"), { code: "ENOTFOUND" });
		const result = await sync.syncAccount(accountId, db);
		expect(result.phase).toBe("failed");
		expect(result.error).toMatch(/Could not find imap.juno.test/);
		expect((await accounts.get(accountId, db))!.lastSyncError).toBe(result.error);
	});

	it("does not start while paused", async () => {
		sync.configureMailSync({ mailDir, isPaused: () => true });
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "one", messageId: "<1@x>", date: recent(2), text: "1" });
		const result = await sync.syncAccount(accountId, db);
		expect(result.phase).toBe("idle");
		expect(box.calls).toEqual([]);
	});

	it("syncs only the folders that are enabled, inbox first", async () => {
		box.folders.push({ path: "Archief", name: "Archief", delimiter: "/", specialUse: null });
		box.messages.set("Archief", [
			{ uid: 1, from: "a@x.be", subject: "archived", messageId: "<z@x>", date: recent(2), text: "z" },
		]);
		await sync.syncAccount(accountId, db);
		const listed = await folders.list(accountId, db);
		expect(listed.map((f) => [f.path, f.syncEnabled])).toEqual([["INBOX", true], ["Archief", false]]);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(0);

		await folders.setSyncEnabled(listed[1]!.id, true, db);
		await sync.syncAccount(accountId, db);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(1);
	});
});

describe("attachments", () => {
	it("writes attachments to disk under an id path with a safe name", async () => {
		const boundary = "b1";
		const source = [
			"From: a@x.be",
			"To: me@juno.test",
			"Subject: Bijlage",
			"Message-ID: <att@x>",
			`Date: ${new Date(recent(1)).toUTCString()}`,
			"MIME-Version: 1.0",
			`Content-Type: multipart/mixed; boundary="${boundary}"`,
			"",
			`--${boundary}`,
			"Content-Type: text/plain",
			"",
			"Zie bijlage.",
			`--${boundary}`,
			"Content-Type: application/pdf",
			'Content-Disposition: attachment; filename="../../offerte.pdf"',
			"Content-Transfer-Encoding: base64",
			"",
			Buffer.from("%PDF-1.4 fake").toString("base64"),
			`--${boundary}--`,
			"",
		].join("\r\n");
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "Bijlage", messageId: "<att@x>", date: recent(1) });
		box.sourceOf = () => Buffer.from(source);

		await sync.syncAccount(accountId, db);
		const list = await threads.listThreads({ accountId }, db);
		expect(list[0]!.hasAttachments).toBe(true);
		const thread = (await threads.getThread(list[0]!.id, db))!;
		const [attachment] = thread.messages[0]!.attachments;
		expect(attachment!.filename).toBe("offerte.pdf");
		expect(attachment!.mimeType).toBe("application/pdf");

		const { path } = threads.attachmentPath(attachment!.id, db);
		expect(path.startsWith(mailDir)).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("%PDF-1.4 fake");
	});
});

describe("client linking", () => {
	it("links a thread to the client whose contact wrote it, and leaves a manual choice alone", async () => {
		const obet = await clientsService.create({ name: "obet" }, db);
		const noir = await clientsService.create({ name: "noir" }, db);
		await clientEmailsService.create({ clientId: noir.id, email: "info@noir.be" }, db);
		await contactsService.create({ clientId: obet.id, name: "Laura", email: "laura@obet.be" }, db);

		box.add("INBOX", { uid: 1, from: "laura@obet.be", subject: "Van Laura", messageId: "<l@obet>", date: recent(3), text: "x" });
		box.add("INBOX", { uid: 2, from: "info@noir.be", subject: "Van noir", messageId: "<n@noir>", date: recent(2), text: "x" });
		box.add("INBOX", { uid: 3, from: "someone@else.be", subject: "Onbekend", messageId: "<u@else>", date: recent(1), text: "x" });
		await sync.syncAccount(accountId, db);

		const list = await threads.listThreads({ accountId }, db);
		const bySubject = Object.fromEntries(list.map((t) => [t.subject, t]));
		expect(bySubject["Van Laura"]!.clientName).toBe("obet");
		expect(bySubject["Van Laura"]!.linkSource).toBe("auto");
		expect(bySubject["Van noir"]!.clientName).toBe("noir");
		expect(bySubject["Onbekend"]!.clientId).toBeNull();

		// A person moves the unknown one to obet, and unlinks Laura's.
		await threads.linkClient(bySubject["Onbekend"]!.id, obet.id, db);
		await threads.unlinkClient(bySubject["Van Laura"]!.id, db);

		// A reply from Laura arrives on the unlinked thread. Auto-link must not undo the person.
		box.add("INBOX", {
			uid: 4, from: "laura@obet.be", subject: "Re: Van Laura", messageId: "<l2@obet>",
			inReplyTo: "<l@obet>", date: recent(0), text: "x",
		});
		await sync.syncAccount(accountId, db);

		const after = Object.fromEntries((await threads.listThreads({ accountId }, db)).map((t) => [t.subject, t]));
		expect(after["Van Laura"]!.clientId).toBeNull();
		expect(after["Van Laura"]!.linkSource).toBe("manual");
		expect(after["Van Laura"]!.messageCount).toBe(2);
		expect(after["Onbekend"]!.clientName).toBe("obet");
		expect(after["Onbekend"]!.linkSource).toBe("manual");

		expect(await threads.listThreads({ accountId, clientId: obet.id }, db)).toHaveLength(1);
		expect(await threads.countForClient(obet.id, db)).toBe(1);
	});

	it("merges two threads when the message that joins them arrives last", async () => {
		// Two replies to a message that has not arrived yet, then the original.
		box.add("INBOX", { uid: 1, from: "a@x.be", subject: "Re: root", messageId: "<r1@x>", inReplyTo: "<root@x>", date: recent(3), text: "x" });
		box.add("INBOX", { uid: 2, from: "b@x.be", subject: "Re: root", messageId: "<r2@x>", inReplyTo: "<root@x>", date: recent(2), text: "x" });
		await sync.syncAccount(accountId, db);
		expect(await threads.listThreads({ accountId }, db)).toHaveLength(2);

		box.add("INBOX", { uid: 3, from: "c@x.be", subject: "root", messageId: "<root@x>", date: recent(4), text: "x" });
		await sync.syncAccount(accountId, db);
		const list = await threads.listThreads({ accountId }, db);
		expect(list).toHaveLength(1);
		expect(list[0]!.messageCount).toBe(3);
		expect(list[0]!.subject).toBe("root");
	});
});

describe("search", () => {
	it("finds a phrase in a body and ranks the thread by it", async () => {
		box.add("INBOX", { uid: 1, from: "laura@obet.be", subject: "Offerte", messageId: "<a@obet>", date: recent(3), text: "De hostingprijs is 40 euro per maand." });
		box.add("INBOX", { uid: 2, from: "info@noir.be", subject: "Vraag", messageId: "<b@noir>", date: recent(1), text: "Wanneer komt de factuur?" });
		await sync.syncAccount(accountId, db);

		const hits = await threads.listThreads({ accountId, search: "hostingprijs" }, db);
		expect(hits).toHaveLength(1);
		expect(hits[0]!.subject).toBe("Offerte");
		expect(hits[0]!.snippet).toContain("hostingprijs");

		expect(await threads.listThreads({ accountId, search: "factu" }, db)).toHaveLength(1);
		expect(await threads.listThreads({ accountId, search: "laura" }, db)).toHaveLength(1);
		expect(await threads.listThreads({ accountId, search: "nothing here" }, db)).toHaveLength(0);
		// Punctuation a person types must not become query syntax.
		expect(await threads.listThreads({ accountId, search: 'factuur" OR (' }, db)).toHaveLength(1);
	});
});
