/**
 * Mailbox rules, against a fake mailbox that both reads and writes.
 *
 * What is held here is what makes a standing instruction to file mail safe to
 * leave alone: a message is looked at once and never again (through a restart, a
 * re-sync and a UIDVALIDITY change), mail that was already there when the
 * account was connected is never touched, one failing message does not stop the
 * others or come back on the next pass, and every action says which rule did it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailFolders, mailMessages, mailRuleRuns, mailRuleSeen, mailThreads } from "../db/schema";
import type { MailRuleAction, MailRuleCondition, MailRuleInput } from "../../shared/types";
import * as accounts from "./mail-accounts";
import * as clientEmails from "./client-emails";
import * as clients from "./clients";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import * as rules from "./mail-rules";
import {
	configureMailboxSource,
	type MailboxSource,
	type RemoteFolder,
	type RemoteHeader,
} from "./mail-source";
import * as sync from "./mail-sync";
import * as threads from "./mail-threads";
import { configureMailboxWriter, configureWriterRetry, type MailboxWriter } from "./mail-writer";
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
	fromName?: string | null;
	to?: string[];
	subject: string;
	messageId: string | null;
	date: string;
	flags: string[];
	hasAttachments?: boolean;
};

const REMOTE_FOLDERS: RemoteFolder[] = [
	{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" },
	{ path: "Archive", name: "Archive", delimiter: "/", specialUse: "archive" },
	{ path: "Trash", name: "Trash", delimiter: "/", specialUse: "trash" },
	{ path: "Offertes", name: "Offertes", delimiter: "/", specialUse: null },
];

class FakeMailbox {
	messages = new Map<string, FakeMessage[]>(REMOTE_FOLDERS.map((f) => [f.path, []]));
	uidValidity = new Map<string, string>(REMOTE_FOLDERS.map((f) => [f.path, "1"]));
	nextUid = 5000;
	writersOpened = 0;
	/** Every uid list a move was asked for, so a retry is visible. */
	moveCalls: number[][] = [];
	flagCalls: number[][] = [];
	/** Subjects the server refuses to move. */
	refuseMoveOf = new Set<string>();
	refuseAll: Error | null = null;
	open = "INBOX";

	inbox(): FakeMessage[] {
		return this.messages.get("INBOX")!;
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
						from: { name: m.fromName ?? null, address: m.from },
						to: (m.to ?? ["me@juno.test"]).map((address) => ({ name: null, address })),
						cc: [],
						replyTo: [],
					},
					hasAttachments: m.hasAttachments ?? false,
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
			if (!m) return null;
			return Buffer.from(
				[
					`From: ${m.from}`,
					"To: me@juno.test",
					`Subject: ${m.subject}`,
					m.messageId ? `Message-ID: ${m.messageId}` : "X-None: 1",
					`Date: ${new Date(m.date).toUTCString()}`,
					"MIME-Version: 1.0",
					'Content-Type: text/plain; charset="utf-8"',
					"",
					"Body.",
				].join("\r\n"),
			);
		},
		async close() {},
	};
}

function writerOver(box: FakeMailbox): MailboxWriter {
	box.writersOpened += 1;
	let open = "INBOX";
	const check = () => {
		if (box.refuseAll) throw box.refuseAll;
	};
	return {
		async openFolder(path) {
			check();
			open = path;
			return { uidValidity: box.uidValidity.get(path) ?? "1" };
		},
		async createFolder() {},
		async renameFolder() {},
		async deleteFolder() {},
		async setFlags(uids, add, remove) {
			check();
			box.flagCalls.push([...uids]);
			for (const message of box.messages.get(open) ?? []) {
				if (!uids.includes(message.uid)) continue;
				const set = new Set(message.flags);
				for (const flag of add) set.add(flag);
				for (const flag of remove) set.delete(flag);
				message.flags = [...set];
			}
		},
		async move(uids, toPath) {
			check();
			box.moveCalls.push([...uids]);
			const from = box.messages.get(open) ?? [];
			const refused = from.find((m) => uids.includes(m.uid) && box.refuseMoveOf.has(m.subject));
			if (refused) throw new Error(`The server refused to move "${refused.subject}".`);
			const to = box.messages.get(toPath) ?? [];
			const map = new Map<number, number>();
			for (const uid of uids) {
				const found = from.find((m) => m.uid === uid);
				if (!found) continue;
				const landed = box.nextUid++;
				to.push({ ...found, uid: landed });
				map.set(uid, landed);
			}
			box.messages.set(open, from.filter((m) => !uids.includes(m.uid)));
			return map;
		},
		async expunge() {},
		async close() {},
	};
}

let db: Db;
let box: FakeMailbox;
let mailDir: string;
let accountId: string;
let tick = 0;

/** A new message in the inbox, dated after the account was connected. */
function arrive(over: Partial<FakeMessage> & { subject: string }): FakeMessage {
	tick += 1;
	const message: FakeMessage = {
		uid: 100 + tick,
		from: "someone@example.be",
		messageId: `<m${tick}@example.be>`,
		date: new Date(Date.now() + tick * 1000).toISOString(),
		flags: [],
		...over,
	};
	box.inbox().push(message);
	return message;
}

function folderId(path: string): string {
	const row = db
		.select({ id: mailFolders.id })
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), eq(mailFolders.path, path), isNull(mailFolders.deletedAt)))
		.get();
	if (!row) throw new Error(`no folder ${path}`);
	return row.id;
}

function rule(over: Partial<MailRuleInput> & { name: string }) {
	return rules.create(
		{
			accountId,
			conditions: [{ kind: "text", field: "sender", test: "contains", value: "news@" }],
			actions: [{ kind: "mark_read" }],
			...over,
		},
		db,
	);
}

const fromNews: MailRuleCondition = { kind: "text", field: "sender", test: "contains", value: "news@" };

function history() {
	return rules.runs({ accountId, limit: 200 }, db);
}

function liveIn(path: string) {
	return db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.folderId, folderId(path)), isNull(mailMessages.deletedAt)))
		.all();
}

async function pass() {
	return sync.syncAccount(accountId, db);
}

beforeEach(async () => {
	db = freshDb();
	box = new FakeMailbox();
	tick = 0;
	mailDir = mkdtempSync(join(tmpdir(), "juno-rules-"));
	configureCredentialStore(new MemoryCredentialStore());
	configureSettings(mkdtempSync(join(tmpdir(), "juno-rules-settings-")));
	configureMailboxSource(async () => box.source());
	configureMailboxWriter(async () => box.writer());
	configureWriterRetry([]);
	sync.configureMailSync({ mailDir, afterInbox: (id, d) => rules.runForAccount(id, d) });
	threads.configureMailThreads(mailDir);
	sync.resetForTests();

	const account = await accounts.create(
		{ email: "me@juno.test", imapHost: "imap.juno.test", password: "secret", horizonDays: 3650 },
		db,
	);
	accountId = account.id;

	// Years of mail that was already there. It is read by the first sync and
	// must never reach a rule.
	for (let i = 0; i < 30; i += 1) {
		box.inbox().push({
			uid: 1 + i,
			from: "news@hyge.be",
			subject: `Old ${i}`,
			messageId: `<old${i}@hyge.be>`,
			date: new Date(Date.now() - (400 + i) * 24 * 3600 * 1000).toISOString(),
			flags: [],
		});
	}
});

afterEach(() => {
	rmSync(mailDir, { recursive: true, force: true });
});

describe("writing rules", () => {
	beforeEach(async () => {
		await pass();
	});

	it("keeps them in order, adds to the end and reorders", () => {
		const a = rule({ name: "A" });
		const b = rule({ name: "B" });
		const c = rule({ name: "C" });
		expect(rules.list(accountId, db).map((r) => r.name)).toEqual(["A", "B", "C"]);
		rules.reorder(accountId, [c.id, a.id, b.id], db);
		expect(rules.list(accountId, db).map((r) => r.name)).toEqual(["C", "A", "B"]);
		expect(() => rules.reorder(accountId, [c.id, a.id], db)).toThrow(/every rule/);
		expect(() => rules.reorder(accountId, [c.id, c.id, a.id], db)).toThrow(/every rule/);
	});

	it("validates its own input", () => {
		expect(() => rule({ name: " " })).toThrow(/name/);
		expect(() => rule({ name: "A", conditions: [] })).toThrow(/at least one condition/);
		expect(() => rule({ name: "A", actions: [] })).toThrow(/at least one action/);
		expect(() => rule({ name: "A", conditions: [{ kind: "text", field: "sender", test: "contains", value: "  " }] })).toThrow(/text to look for/);
		expect(() => rule({ name: "A", conditions: [{ kind: "text", field: "sender", test: "contains", value: "a\nb" }] })).toThrow(/one line/);
		expect(() => rule({ name: "A", conditions: [{ kind: "text", field: "body" as never, test: "contains", value: "a" }] })).toThrow(/not something to test/);
		expect(() => rule({ name: "A", conditions: [{ kind: "regex", value: "(a+)+" } as never] })).toThrow(/not a condition/);
		expect(() => rule({ name: "A", actions: [{ kind: "trash" }, { kind: "archive" }] })).toThrow(/one place/);
		expect(() => rule({ name: "A", actions: [{ kind: "flag" }, { kind: "flag" }] })).toThrow(/once/);
		expect(() => rule({ name: "A", actions: [{ kind: "delete" } as never] })).toThrow(/not an action/);
		expect(() => rule({ name: "A", actions: [{ kind: "move", folderId: "nope" }] })).toThrow(/not one of this account/);
		expect(() => rule({ name: "A", actions: [{ kind: "move", folderId: folderId("INBOX") }] })).toThrow(/already arrives/);
		expect(() => rules.create({ accountId: "nope", name: "A", conditions: [fromNews], actions: [{ kind: "flag" }] }, db)).toThrow(/does not exist/);
	});

	it("keeps only the fields it knows, so nothing an input carries is stored", () => {
		const made = rules.create(
			{
				accountId,
				name: "A",
				conditions: [{ ...fromNews, run: "evil()" } as MailRuleCondition],
				actions: [{ kind: "flag", shell: "rm" } as MailRuleAction],
			},
			db,
		);
		expect(made.conditions).toEqual([fromNews]);
		expect(made.actions).toEqual([{ kind: "flag" }]);
	});

	it("refuses a folder of another account", async () => {
		const other = await accounts.create({ email: "two@juno.test", imapHost: "imap.juno.test", password: "x" }, db);
		await sync.syncAccount(other.id, db);
		const foreign = db
			.select({ id: mailFolders.id })
			.from(mailFolders)
			.where(and(eq(mailFolders.accountId, other.id), eq(mailFolders.path, "Offertes")))
			.get()!;
		expect(() => rule({ name: "A", actions: [{ kind: "move", folderId: foreign.id }] })).toThrow(/not one of this account/);
	});

	it("soft deletes, and the history keeps the name the rule had", async () => {
		const made = rule({ name: "Newsletters" });
		arrive({ subject: "Hello", from: "news@hyge.be" });
		await pass();
		rules.update(made.id, { name: "Renamed" }, db);
		rules.remove(made.id, db);
		expect(rules.list(accountId, db)).toEqual([]);
		expect(() => rules.get(made.id, db)).toThrow(/does not exist/);
		expect(history().map((run) => run.ruleName)).toEqual(["Newsletters"]);
	});
});

describe("what a pass does", () => {
	beforeEach(async () => {
		await pass();
	});

	it("never touches mail that was in the mailbox when it was connected", async () => {
		rule({ name: "Trash old news", actions: [{ kind: "trash" }] });
		expect(liveIn("INBOX")).toHaveLength(30);
		await pass();
		expect(liveIn("INBOX")).toHaveLength(30);
		expect(history()).toEqual([]);
		expect(box.writersOpened).toBe(0);
	});

	it("does not file years of mail when an account is first synced with its rules already written", async () => {
		const fresh = await accounts.create(
			{ email: "late@juno.test", imapHost: "imap.juno.test", password: "x", horizonDays: 3650 },
			db,
		);
		// Its rule exists before its first sync, and the mailbox holds thirty old messages.
		rules.create({ accountId: fresh.id, name: "All news", conditions: [fromNews], actions: [{ kind: "trash" }] }, db);
		const writersBefore = box.writersOpened;
		await sync.syncAccount(fresh.id, db);
		expect(box.inbox().length).toBe(30);
		expect(box.writersOpened).toBe(writersBefore);
		expect(rules.runs({ accountId: fresh.id }, db)).toEqual([]);
		expect(box.messages.get("Trash")).toHaveLength(0);

		// What arrives afterwards is new mail.
		arrive({ subject: "Fresh", from: "news@hyge.be" });
		await sync.syncAccount(fresh.id, db);
		expect(box.messages.get("Trash")!.map((m) => m.subject)).toEqual(["Fresh"]);
		expect(rules.runs({ accountId: fresh.id }, db)).toHaveLength(1);
	});

	it("files mail that arrives after the account was connected", async () => {
		rule({ name: "News to Trash", actions: [{ kind: "trash" }] });
		arrive({ subject: "Autumn", from: "news@hyge.be" });
		arrive({ subject: "Roof", from: "jansen@example.be" });
		const status = await pass();
		expect(status.phase).toBe("done");

		expect(box.messages.get("Trash")!.map((m) => m.subject)).toEqual(["Autumn"]);
		expect(box.inbox().map((m) => m.subject)).toContain("Roof");
		expect(box.inbox().map((m) => m.subject)).not.toContain("Autumn");
		const runs = history();
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ ruleName: "News to Trash", action: "trash", result: "done", subject: "Autumn", detail: "Trash" });
		// The local rows agree with the server.
		expect(liveIn("Trash").map((m) => m.subject)).toEqual(["Autumn"]);
	});

	it("marks read, flags, archives and moves to a folder, on the server and here", async () => {
		rule({ name: "Read", conditions: [{ kind: "text", field: "subject", test: "starts_with", value: "r:" }], actions: [{ kind: "mark_read" }] });
		rule({ name: "Flag", conditions: [{ kind: "text", field: "subject", test: "starts_with", value: "f:" }], actions: [{ kind: "flag" }] });
		rule({ name: "Archive", conditions: [{ kind: "text", field: "subject", test: "starts_with", value: "a:" }], actions: [{ kind: "archive" }] });
		rule({
			name: "Offers",
			conditions: [{ kind: "text", field: "subject", test: "starts_with", value: "o:" }],
			actions: [{ kind: "move", folderId: folderId("Offertes") }, { kind: "mark_read" }],
		});
		arrive({ subject: "r: one" });
		arrive({ subject: "f: two" });
		arrive({ subject: "a: three" });
		arrive({ subject: "o: four" });
		await pass();

		const read = box.inbox().find((m) => m.subject === "r: one")!;
		expect(read.flags).toContain("\\Seen");
		expect(box.inbox().find((m) => m.subject === "f: two")!.flags).toContain("\\Flagged");
		expect(box.messages.get("Archive")!.map((m) => m.subject)).toEqual(["a: three"]);
		const offer = box.messages.get("Offertes")![0]!;
		expect(offer.subject).toBe("o: four");
		// The read mark was made before the move, so it travelled with the message.
		expect(offer.flags).toContain("\\Seen");
		expect(liveIn("Offertes").map((m) => m.subject)).toEqual(["o: four"]);
		expect(liveIn("INBOX").find((m) => m.subject === "r: one")!.isSeen).toBe(true);
		expect(history().map((run) => `${run.ruleName}:${run.action}:${run.result}`).sort()).toEqual([
			"Archive:archive:done",
			"Flag:flag:done",
			"Offers:mark_read:done",
			"Offers:move:done",
			"Read:mark_read:done",
		]);
		expect(history().find((run) => run.action === "move")!.detail).toBe("Offertes");
	});

	it("has nothing to add when the conversation was linked on the way in", async () => {
		const client = await clients.create({ name: "Hyge" }, db);
		await clientEmails.create({ clientId: client.id, email: "news@hyge.be" }, db);
		rule({ name: "Link", conditions: [{ kind: "sender_is_client", value: true }], actions: [{ kind: "link_client" }] });
		arrive({ subject: "From a client", from: "news@hyge.be" });
		await pass();
		expect(history()[0]).toMatchObject({ action: "link_client", result: "skipped" });
		expect(history()[0]!.error).toMatch(/Already linked/);
	});

	describe("linking by hand-run pass", () => {
		beforeEach(() => {
			// No hook: the mail is stored first and the rules are run by the test.
			sync.configureMailSync({ mailDir });
		});

		it("links an unlinked conversation when the address belongs to exactly one client", async () => {
			rule({ name: "Link", conditions: [{ kind: "text", field: "sender", test: "ends_with", value: "@hyge.be" }], actions: [{ kind: "link_client" }] });
			arrive({ subject: "Before the client", from: "news@hyge.be" });
			await pass();
			const client = await clients.create({ name: "Hyge" }, db);
			await clientEmails.create({ clientId: client.id, email: "news@hyge.be" }, db);
			await rules.runForAccount(accountId, db);
			const thread = db.select().from(mailThreads).all().find((t) => t.subject === "Before the client")!;
			expect(thread.clientId).toBe(client.id);
			expect(history()[0]).toMatchObject({ action: "link_client", result: "done", detail: "Hyge" });
		});

		it("leaves a conversation a person linked alone", async () => {
			rule({ name: "Link", conditions: [{ kind: "text", field: "sender", test: "ends_with", value: "@hyge.be" }], actions: [{ kind: "link_client" }] });
			arrive({ subject: "Chosen", from: "news@hyge.be" });
			await pass();
			const client = await clients.create({ name: "Hyge" }, db);
			await clientEmails.create({ clientId: client.id, email: "news@hyge.be" }, db);
			const other = await clients.create({ name: "Other" }, db);
			const thread = db.select().from(mailThreads).all().find((t) => t.subject === "Chosen")!;
			await threads.linkClient(thread.id, other.id, db);
			await rules.runForAccount(accountId, db);
			expect(db.select().from(mailThreads).where(eq(mailThreads.id, thread.id)).get()!.clientId).toBe(other.id);
			expect(history()[0]).toMatchObject({ result: "skipped" });
			expect(history()[0]!.error).toMatch(/person already chose/);
		});
	});

	it("tests the sender as a client and attachments", async () => {
		const client = await clients.create({ name: "Hyge" }, db);
		await clientEmails.create({ clientId: client.id, email: "news@hyge.be" }, db);
		rule({ name: "Client with attachment", match: "all", conditions: [{ kind: "sender_is_client", value: true }, { kind: "has_attachments", value: true }], actions: [{ kind: "flag" }] });
		rule({ name: "Not a client", conditions: [{ kind: "sender_is_client", value: false }, { kind: "text", field: "recipient", test: "contains", value: "list@" }], actions: [{ kind: "mark_read" }] });
		arrive({ subject: "A", from: "news@hyge.be", hasAttachments: true });
		arrive({ subject: "B", from: "news@hyge.be", hasAttachments: false });
		arrive({ subject: "C", from: "spam@example.be", to: ["list@juno.test"] });
		await pass();
		const byName = (name: string) => history().filter((run) => run.ruleName === name).map((run) => run.subject);
		expect(byName("Client with attachment")).toEqual(["A"]);
		expect(byName("Not a client")).toEqual(["C"]);
	});

	it("does not run a switched off rule", async () => {
		const off = rule({ name: "Off", actions: [{ kind: "trash" }] });
		rules.update(off.id, { enabled: false }, db);
		arrive({ subject: "Autumn", from: "news@hyge.be" });
		await pass();
		expect(box.messages.get("Trash")).toHaveLength(0);
		expect(history()).toEqual([]);
	});
});

describe("order, and whether a match stops the rest", () => {
	beforeEach(async () => {
		await pass();
	});

	it("lets rules below see a message when the rule above does not stop", async () => {
		rule({ name: "First", actions: [{ kind: "flag" }] });
		rule({ name: "Second", actions: [{ kind: "mark_read" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		expect(history().map((run) => run.ruleName).sort()).toEqual(["First", "Second"]);
	});

	it("keeps a message from the rules below when the rule asks to stop", async () => {
		rule({ name: "First", actions: [{ kind: "flag" }], stopOnMatch: true });
		rule({ name: "Second", actions: [{ kind: "mark_read" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		expect(history().map((run) => run.ruleName)).toEqual(["First"]);
	});

	it("goes in the order the list says, so a reorder changes who stops whom", async () => {
		const first = rule({ name: "Wide", conditions: [{ kind: "text", field: "sender", test: "contains", value: "@" }], actions: [{ kind: "flag" }], stopOnMatch: true });
		const narrow = rule({ name: "Narrow", actions: [{ kind: "mark_read" }] });
		rules.reorder(accountId, [narrow.id, first.id], db);
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		// Narrow is first now and does not stop, so Wide also runs.
		expect(history().map((run) => run.ruleName).sort()).toEqual(["Narrow", "Wide"]);
	});

	it("does not offer a moved message to the rules below, because it is not in the inbox any more", async () => {
		rule({ name: "Mover", actions: [{ kind: "trash" }] });
		rule({ name: "Below", actions: [{ kind: "flag" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		expect(history().map((run) => run.ruleName)).toEqual(["Mover"]);
	});

	it("takes any condition for an any rule", async () => {
		rule({
			name: "Either",
			match: "any",
			conditions: [
				{ kind: "text", field: "subject", test: "contains", value: "invoice" },
				{ kind: "text", field: "subject", test: "contains", value: "factuur" },
			],
			actions: [{ kind: "flag" }],
		});
		arrive({ subject: "Uw FACTUUR" });
		arrive({ subject: "Hello" });
		await pass();
		expect(history().map((run) => run.subject)).toEqual(["Uw FACTUUR"]);
	});
});

describe("a message is looked at once", () => {
	beforeEach(async () => {
		await pass();
	});

	it("is not run again by the next sync, or after a restart", async () => {
		rule({ name: "Flag", actions: [{ kind: "flag" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		expect(history()).toHaveLength(1);
		const calls = box.flagCalls.length;

		await pass();
		// A restart forgets everything held in memory. The record is in the database.
		sync.resetForTests();
		await pass();
		expect(history()).toHaveLength(1);
		expect(box.flagCalls).toHaveLength(calls);
	});

	it("is not run again when the server renumbers the inbox and the mail comes back under new uids", async () => {
		rule({ name: "Flag", actions: [{ kind: "flag" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		expect(history()).toHaveLength(1);
		const calls = box.flagCalls.length;
		const rowsBefore = db.select().from(mailMessages).all().length;

		box.uidValidity.set("INBOX", "2");
		for (const message of box.inbox()) message.uid += 10_000;
		await pass();

		// The old local rows were thrown away and the mail was read in again.
		expect(db.select().from(mailMessages).all().length).toBeGreaterThan(rowsBefore);
		expect(history()).toHaveLength(1);
		expect(box.flagCalls).toHaveLength(calls);

		// And mail that really is new after the renumbering is still looked at.
		arrive({ subject: "y", from: "news@hyge.be" });
		await pass();
		expect(history().map((run) => run.subject)).toEqual(["y", "x"]);
	});

	it("is not run again for old mail that a renumbering brings back", async () => {
		rule({ name: "Trash", actions: [{ kind: "trash" }], conditions: [{ kind: "text", field: "sender", test: "contains", value: "hyge" }] });
		box.uidValidity.set("INBOX", "7");
		for (const message of box.inbox()) message.uid += 20_000;
		await pass();
		expect(history()).toEqual([]);
		expect(box.writersOpened).toBe(0);
	});

	it("is not run again when a person moves it back to the inbox", async () => {
		rule({ name: "Trash", actions: [{ kind: "trash" }] });
		arrive({ subject: "x", from: "news@hyge.be", messageId: "<back@hyge.be>" });
		await pass();
		expect(box.messages.get("Trash")).toHaveLength(1);
		// Back in the inbox under a new uid, the way a move back looks.
		const moved = box.messages.get("Trash")!.pop()!;
		box.inbox().push({ ...moved, uid: 9999 });
		await pass();
		expect(box.inbox().map((m) => m.subject)).toContain("x");
		expect(history()).toHaveLength(1);
	});

	it("keeps a message with no Message-ID from coming round again too", async () => {
		rule({ name: "Flag", actions: [{ kind: "flag" }] });
		arrive({ subject: "anonymous", from: "news@hyge.be", messageId: null });
		await pass();
		await pass();
		expect(history()).toHaveLength(1);
		expect(db.select().from(mailRuleSeen).all().some((row) => row.messageKey.startsWith("h:"))).toBe(true);
	});

	it("counts mail that arrived while no rule existed as looked at, so a rule written later does not reach back", async () => {
		arrive({ subject: "before the rule", from: "news@hyge.be" });
		await pass();
		rule({ name: "Trash", actions: [{ kind: "trash" }] });
		await pass();
		expect(box.messages.get("Trash")).toHaveLength(0);
		arrive({ subject: "after the rule", from: "news@hyge.be" });
		await pass();
		expect(box.messages.get("Trash")!.map((m) => m.subject)).toEqual(["after the rule"]);
	});

	it("looks only at the inbox", async () => {
		rule({ name: "Everything", conditions: [{ kind: "text", field: "sender", test: "contains", value: "@" }], actions: [{ kind: "flag" }] });
		box.messages.get("Offertes")!.push({
			uid: 77,
			from: "a@b.be",
			subject: "In another folder",
			messageId: "<o@b.be>",
			date: new Date(Date.now() + 5000).toISOString(),
			flags: [],
		});
		await pass();
		expect(history()).toEqual([]);
	});
});

describe("when an action fails", () => {
	beforeEach(async () => {
		await pass();
	});

	it("moves the others, records the one that failed, and never tries it again", async () => {
		rule({ name: "Trash", actions: [{ kind: "trash" }] });
		arrive({ subject: "fine 1", from: "news@hyge.be" });
		arrive({ subject: "boom", from: "news@hyge.be" });
		arrive({ subject: "fine 2", from: "news@hyge.be" });
		box.refuseMoveOf.add("boom");

		const status = await pass();
		expect(status.phase).toBe("done");
		expect(status.error).toBeNull();
		expect(box.messages.get("Trash")!.map((m) => m.subject).sort()).toEqual(["fine 1", "fine 2"]);
		expect(box.inbox().map((m) => m.subject)).toContain("boom");

		const failed = history().filter((run) => run.result === "failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({ subject: "boom", ruleName: "Trash", action: "trash" });
		expect(failed[0]!.error).toMatch(/refused/);
		expect(history().filter((run) => run.result === "done")).toHaveLength(2);

		const calls = box.moveCalls.length;
		box.refuseMoveOf.clear();
		await pass();
		await pass();
		expect(box.moveCalls).toHaveLength(calls);
		expect(box.inbox().map((m) => m.subject)).toContain("boom");
	});

	it("stops asking a server that is down after a few messages, and says so for the rest", async () => {
		rule({ name: "Trash", actions: [{ kind: "trash" }] });
		for (let i = 0; i < 6; i += 1) arrive({ subject: `m${i}`, from: "news@hyge.be" });
		box.refuseAll = new Error("Connection reset");
		const status = await pass();
		// A failing action is not a failing sync.
		expect(status.phase).toBe("done");
		const failed = history().filter((run) => run.result === "failed");
		expect(failed).toHaveLength(6);
		expect(failed.filter((run) => run.error?.startsWith("Not tried"))).toHaveLength(3);
		// The batch, then three single tries, and no more.
		expect(box.writersOpened).toBeLessThanOrEqual(4);
		expect(box.inbox().filter((m) => m.subject.startsWith("m"))).toHaveLength(6);
	});

	it("does not fail the sync when the hook itself throws", async () => {
		sync.configureMailSync({
			mailDir,
			afterInbox: async () => {
				throw new Error("rules exploded");
			},
		});
		arrive({ subject: "x" });
		const status = await pass();
		expect(status.phase).toBe("done");
	});
});

describe("while locked", () => {
	beforeEach(async () => {
		await pass();
	});

	it("does nothing and leaves the mail for later", async () => {
		rule({ name: "Trash", actions: [{ kind: "trash" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		const tally = await rules.runForAccount(accountId, db, { isPaused: () => true });
		expect(tally.checked).toBe(0);
		expect(box.messages.get("Trash")).toHaveLength(0);
		expect(db.select().from(mailRuleSeen).all()).toEqual([]);

		await pass();
		expect(box.messages.get("Trash")!.map((m) => m.subject)).toEqual(["x"]);
	});

	it("records what a lock cut short as skipped", async () => {
		sync.configureMailSync({ mailDir });
		rule({ name: "Read then trash", actions: [{ kind: "mark_read" }, { kind: "trash" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		let checks = 0;
		// Unlocked for the start and the first action, locked before the move.
		const tally = await rules.runForAccount(accountId, db, { isPaused: () => ++checks > 2 });
		expect(tally.done).toBe(1);
		expect(tally.skipped).toBe(1);
		expect(history().map((run) => `${run.action}:${run.result}`).sort()).toEqual(["mark_read:done", "trash:skipped"]);
		expect(history().find((run) => run.result === "skipped")!.error).toMatch(/locked/);
		expect(box.messages.get("Trash")).toHaveLength(0);
	});
});

describe("hostile mail", () => {
	beforeEach(async () => {
		await pass();
	});

	it("matches a sender on the address, never on the name beside it", async () => {
		rule({ name: "Trash news", actions: [{ kind: "trash" }] });
		arrive({ subject: "spoof", from: "evil@elsewhere.test", fromName: "news@hyge.be" });
		await pass();
		expect(history()).toEqual([]);
		expect(box.messages.get("Trash")).toHaveLength(0);
	});

	it("treats pattern characters in a subject and in a rule as plain text", async () => {
		rule({ name: "Weird", conditions: [{ kind: "text", field: "subject", test: "contains", value: "[a-z]+(.*)$" }], actions: [{ kind: "flag" }] });
		arrive({ subject: "abc" });
		arrive({ subject: "see [a-z]+(.*)$ here" });
		await pass();
		expect(history().map((run) => run.subject)).toEqual(["see [a-z]+(.*)$ here"]);
	});

	it("copes with a very long subject, and stores a short copy of it", async () => {
		rule({ name: "Flag all", conditions: [{ kind: "text", field: "subject", test: "starts_with", value: "x" }], actions: [{ kind: "flag" }] });
		arrive({ subject: `x${"y".repeat(200_000)}` });
		await pass();
		const [run] = history();
		expect(run?.result).toBe("done");
		expect(run!.subject.length).toBeLessThanOrEqual(200);
	});

	it("keeps control characters out of the history it writes", async () => {
		rule({ name: "Flag all", conditions: [{ kind: "text", field: "subject", test: "contains", value: "x" }], actions: [{ kind: "flag" }] });
		arrive({ subject: "x" + String.fromCharCode(27) + "[31m red" + String.fromCharCode(13, 10) + "Second line" });
		await pass();
		expect([...history()[0]!.subject].some((char) => char.charCodeAt(0) < 32)).toBe(false);
	});
});

describe("the history", () => {
	beforeEach(async () => {
		await pass();
	});

	it("names the rule on every row and can be read for one rule", async () => {
		const flag = rule({ name: "Flag", actions: [{ kind: "flag" }] });
		const read = rule({ name: "Read", actions: [{ kind: "mark_read" }] });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		expect(history().every((run) => run.ruleName !== "" && run.messageId !== "")).toBe(true);
		expect(rules.runs({ accountId, ruleId: flag.id }, db).map((run) => run.ruleName)).toEqual(["Flag"]);
		expect(rules.runs({ accountId, ruleId: read.id }, db).map((run) => run.action)).toEqual(["mark_read"]);
		expect(rules.runs({ accountId, limit: 1 }, db)).toHaveLength(1);
		expect(db.select().from(mailRuleRuns).all().every((row) => row.deletedAt === null)).toBe(true);
	});

	it("says in plain words what a stored rule does", async () => {
		const made = rule({ name: "Hyge", actions: [{ kind: "move", folderId: folderId("Offertes") }] });
		const words = rules.explain(made.id, db);
		expect(words).toContain('Rule "Hyge" for me@juno.test, switched on.');
		expect(words).toContain("move it to Offertes");
	});

	it("shows the owner the whole rule before an agent's change, and refuses a stale approval", async () => {
		const made = rule({ name: "Hyge", actions: [{ kind: "flag" }] });
		const review = rules.reviewUpdate(made.id, { enabled: false, actions: [{ kind: "trash" }] }, db);
		expect(review.preview).toContain("Now: Rule \"Hyge\" for me@juno.test, switched on.");
		expect(review.preview).toContain("After: Rule \"Hyge\" for me@juno.test, switched off.");
		expect(review.preview).toContain("move it to Trash");
		expect(() => rules.verifySeal(review, review.seal)).not.toThrow();
		rules.update(made.id, { name: "Changed by hand" }, db);
		expect(() => rules.verifySeal(rules.reviewUpdate(made.id, { enabled: false, actions: [{ kind: "trash" }] }, db), review.seal)).toThrow(/changed after/);
		expect(() => rules.verifySeal(review, null)).toThrow(/changed after/);
	});

	it("refuses to review a rule it could not store", () => {
		expect(() => rules.reviewCreate({ accountId, name: "x", conditions: [], actions: [{ kind: "flag" }] }, db)).toThrow(/condition/);
		expect(() => rules.reviewRemove("nope", db)).toThrow(/does not exist/);
	});
});

describe("the data it keeps", () => {
	it("gives every table the standard columns and filters the deleted", async () => {
		await pass();
		rule({ name: "A" });
		arrive({ subject: "x", from: "news@hyge.be" });
		await pass();
		for (const row of [
			...db.select().from(mailRuleRuns).all(),
			...db.select().from(mailRuleSeen).all(),
		]) {
			expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(row.ownerId).toBeTruthy();
			expect(row.createdAt).toMatch(/Z$/);
			expect(row.updatedAt).toMatch(/Z$/);
			expect(row.deletedAt).toBeNull();
		}
	});
});
