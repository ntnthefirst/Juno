/**
 * The outbox and the sender against a fake transport. The gate is the thing
 * under test: an agent's message must wait for a person, and the sender must
 * never see anything that did not pass through the gate.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { documents, mailFolders, mailMessages, mailOutbox, mailThreads } from "../db/schema";
import * as clientsService from "./clients";
import * as contactsService from "./contacts";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import { htmlToText, textToHtml } from "./mail-html";
import * as outbox from "./mail-outbox";
import * as sender from "./mail-send";
import * as templates from "./mail-templates";
import * as threads from "./mail-threads";
import {
	configureMailTransport,
	type OutgoingMessage,
	type SmtpConnection,
} from "./mail-transport";
import { configureSettings } from "./settings";
import type { MailOutboxMessage } from "../../shared/types";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

/**
 * A cover mail of the test's own. No install is promised any template by key,
 * so a test that needs one writes it, the way the owner would.
 */
async function coverTemplate() {
	return templates.create(
		{
			name: "Contract ter ondertekening",
			subject: "{{ document.title }} ter ondertekening",
			bodyHtml:
				"<p>Beste {{ client.contactName }},</p>" +
				"<p>In bijlage vindt u {{ document.title }}.</p>" +
				"<p>Met vriendelijke groeten,<br>{{ owner.contactName }}</p>",
		},
		db,
	);
}

let db: Db;
let dir: string;
let accountId: string;
let sentMessages: { connection: SmtpConnection; message: OutgoingMessage }[];
let appended: { folder: string; raw: Buffer }[];
let failNext: unknown;

beforeEach(async () => {
	db = freshDb();
	dir = mkdtempSync(join(tmpdir(), "juno-outbox-"));
	configureSettings(dir);
	configureCredentialStore(new MemoryCredentialStore());
	sentMessages = [];
	appended = [];
	failNext = null;
	configureMailTransport(
		{
			async verify() {
				return;
			},
			async send(connection, message) {
				if (failNext) {
					const error = failNext;
					failNext = null;
					throw error;
				}
				sentMessages.push({ connection, message });
				return { raw: Buffer.from(`raw:${message.messageId}`), accepted: message.to.map((a) => a.address), rejected: [] };
			},
		},
		async (_connection, folder, raw) => {
			appended.push({ folder, raw });
		},
	);
	sender.resetForTests();

	const account = await accounts.create(
		{
			email: "hallo@juno.test",
			imapHost: "imap.juno.test",
			smtpHost: "smtp.juno.test",
			password: "secret",
			fromName: "Nathan",
		},
		db,
	);
	accountId = account.id;
	db.insert(mailFolders)
		.values({ accountId, path: "Sent", name: "Sent", specialUse: "sent", syncEnabled: false })
		.run();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("drafts", () => {
	it("stores a text draft with a plain HTML twin, no template shell, and a stable Message-ID", async () => {
		const draft = await outbox.createDraft(
			{
				accountId,
				to: [{ name: "Laura", address: "Laura@obet.be" }],
				subject: "Offerte",
				bodyText: "Dag Laura,\n\nHierbij de offerte.\n\n> oude regel",
			},
			db,
		);
		expect(draft.state).toBe("draft");
		expect(draft.to).toEqual([{ name: "Laura", address: "laura@obet.be" }]);
		expect(draft.messageId).toMatch(/^<[0-9a-f-]+@juno\.test>$/);
		expect(draft.bodyHtml).toContain("<p style=");
		expect(draft.bodyHtml).toContain("Hierbij de offerte.");
		expect(draft.bodyHtml).toContain("<blockquote");
		expect(draft.bodyHtml).not.toContain("<script");
		expect(draft.bodyHtml).not.toContain("<table");
		expect(draft.bodyHtml).not.toContain("<!doctype");
	});

	it("refuses an address that is not one", async () => {
		await expect(
			outbox.createDraft({ accountId, to: [{ name: null, address: "laura" }], subject: "x", bodyText: "x" }, db),
		).rejects.toThrow(/not an email address/);
	});

	it("escapes typed text on the way into HTML", () => {
		expect(textToHtml("<b>hi</b> & bye")).toContain("&lt;b&gt;hi&lt;/b&gt; &amp; bye");
		expect(htmlToText("<p>Dag <b>Laura</b></p><p>Tot zo.</p>")).toBe("Dag Laura\n\nTot zo.");
	});
});

describe("change notifications", () => {
	it("fires onChange for a draft created, edited, cancelled and removed", async () => {
		const seen: string[] = [];
		const unsubscribe = outbox.onChange((message) => seen.push(`${message.state}:${message.id}`));
		try {
			const created = await outbox.createDraft(
				{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Offerte", bodyText: "Hallo." },
				db,
			);
			const updated = await outbox.updateDraft(created.id, { subject: "Herziene offerte" }, db);
			const cancelled = await outbox.cancel(updated.id, db);
			const removed = await outbox.remove(cancelled.id, db);

			expect(seen).toEqual([
				`draft:${created.id}`,
				`draft:${updated.id}`,
				`cancelled:${cancelled.id}`,
				`cancelled:${removed.id}`,
			]);
		} finally {
			unsubscribe();
		}
	});
});

describe("the gate", () => {
	async function draft(): Promise<string> {
		const made = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Offerte", bodyText: "Hallo." },
			db,
		);
		return made.id;
	}

	it("queues a person's message and sends it, then copies it to Sent", async () => {
		const id = await draft();
		const queued = await outbox.requestSend(id, { actor: "user" }, db);
		expect(queued.state).toBe("queued");
		expect(queued.approvedAt).not.toBeNull();

		expect(await sender.processQueue(db)).toBe(1);
		const sent = (await outbox.get(id, db))!;
		expect(sent.state).toBe("sent");
		expect(sent.attempts).toBe(1);
		expect(sent.appendedToSentAt).not.toBeNull();
		expect(sentMessages).toHaveLength(1);
		expect(sentMessages[0]!.message.from).toEqual({ name: "Nathan", address: "hallo@juno.test" });
		expect(sentMessages[0]!.connection.host).toBe("smtp.juno.test");
		expect(sentMessages[0]!.connection.password).toBe("secret");
		expect(appended).toHaveLength(1);
		expect(appended[0]!.folder).toBe("Sent");
	});

	it("holds an agent's message until a person approves it", async () => {
		const id = await draft();
		const pending = await outbox.requestSend(id, { actor: "agent" }, db);
		expect(pending.state).toBe("pending");
		expect(pending.requestedBy).toBe("agent");

		// The sender does not see it.
		expect(await sender.processQueue(db)).toBe(0);
		expect(sentMessages).toHaveLength(0);

		const approved = await outbox.approve(id, db);
		expect(approved.state).toBe("queued");
		expect(await sender.processQueue(db)).toBe(1);
		expect((await outbox.get(id, db))!.state).toBe("sent");
	});

	it("turns an edited pending message back into a draft", async () => {
		const id = await draft();
		await outbox.requestSend(id, { actor: "agent" }, db);
		const edited = await outbox.updateDraft(id, { subject: "Iets anders" }, db);
		expect(edited.state).toBe("draft");
		expect(edited.requestedBy).toBe("user");
		await expect(outbox.approve(id, db)).rejects.toThrow(/Only a pending/);
	});

	it("refuses to queue a message with nobody in To, and one from an account that cannot send", async () => {
		const empty = await outbox.createDraft({ accountId, to: [], subject: "x", bodyText: "x" }, db);
		await expect(outbox.requestSend(empty.id, { actor: "user" }, db)).rejects.toThrow(/nobody in To/);

		await accounts.update(accountId, { smtpHost: null }, db);
		const id = await draft();
		await expect(outbox.requestSend(id, { actor: "user" }, db)).rejects.toThrow(/no outgoing server/);
	});

	it("refuses to send a template gap to a client", async () => {
		const client = await clientsService.create({ name: "obet" }, db);
		const cover = await coverTemplate();
		// No contact and no owner profile: the greeting and the sign-off are gaps.
		const rendered = await templates.renderTemplate({ templateId: cover.id, clientId: client.id, extras: { title: "de NDA" } }, db);
		expect(rendered.missing).toContain("client.contactName");
		const made = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: rendered.subject, bodyText: rendered.bodyText, bodyHtml: rendered.bodyHtml },
			db,
		);
		await expect(outbox.requestSend(made.id, { actor: "user" }, db)).rejects.toThrow(/placeholder without a value: client.contactName/);
		expect((await outbox.get(made.id, db))!.state).toBe("draft");
	});

	it("cancels anything that has not gone out, and nothing that has", async () => {
		const id = await draft();
		await outbox.requestSend(id, { actor: "agent" }, db);
		expect((await outbox.cancel(id, db)).state).toBe("cancelled");

		const other = await draft();
		await outbox.requestSend(other, { actor: "user" }, db);
		await sender.processQueue(db);
		await expect(outbox.cancel(other, db)).rejects.toThrow(/cannot be cancelled/);
	});

	it("retries a connection failure on its own and a refusal only when asked", async () => {
		const id = await draft();
		await outbox.requestSend(id, { actor: "user" }, db);

		failNext = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
		await sender.processQueue(db);
		let record = (await outbox.get(id, db))!;
		expect(record.state).toBe("queued");
		expect(record.attempts).toBe(1);
		expect(record.lastError).toMatch(/refused the connection.*Trying again/);

		failNext = Object.assign(new Error("550 no such user"), { responseCode: 550 });
		await sender.processQueue(db);
		record = (await outbox.get(id, db))!;
		expect(record.state).toBe("failed");
		expect(record.attempts).toBe(2);

		expect(await sender.processQueue(db)).toBe(0);
		expect((await outbox.retry(id, db)).state).toBe("queued");
		await sender.processQueue(db);
		record = (await outbox.get(id, db))!;
		expect(record.state).toBe("sent");
		expect(record.messageId).toBe(record.messageId);
		expect(sentMessages).toHaveLength(1);
	});

	it("does not send while paused", async () => {
		sender.configureMailSend({ isPaused: () => true });
		const id = await draft();
		await outbox.requestSend(id, { actor: "user" }, db);
		expect(await sender.processQueue(db)).toBe(0);
		expect((await outbox.get(id, db))!.state).toBe("queued");
	});

	it("counts what is waiting on whom", async () => {
		await outbox.requestSend(await draft(), { actor: "agent" }, db);
		await draft();
		expect(await outbox.counts(accountId, db)).toEqual({ pending: 1, queued: 0, failed: 0, drafts: 1 });
	});
});

function storeOriginal(db: Db, messageId = "<orig@obet.be>"): string {
	const threadId = db
		.insert(mailThreads)
		.values({ accountId, subject: "Offerte", subjectNorm: "offerte", firstMessageAt: "2026-09-01T10:00:00.000Z", lastMessageAt: "2026-09-01T10:00:00.000Z" })
		.returning({ id: mailThreads.id })
		.get().id;
	db.insert(mailFolders)
		.values({ accountId, path: "INBOX", name: "INBOX", specialUse: "inbox", syncEnabled: true })
		.onConflictDoNothing()
		.run();
	const folderId = db.select({ id: mailFolders.id }).from(mailFolders).where(eq(mailFolders.path, "INBOX")).get()!.id;
	// One uid per stored message, so a test can keep several threads in one folder.
	const uid = db.select().from(mailMessages).all().length + 1;
	return db
		.insert(mailMessages)
		.values({
			accountId,
			folderId,
			threadId,
			uid,
			messageId,
			referencesJson: JSON.stringify(["<root@obet.be>"]),
			fromName: "Laura",
			fromAddress: "laura@obet.be",
			toJson: JSON.stringify([{ name: null, address: "hallo@juno.test" }, { name: "Tom", address: "tom@obet.be" }]),
			ccJson: JSON.stringify([{ name: null, address: "cc@elders.be" }]),
			subject: "Offerte",
			snippet: "Kunnen we",
			internalDate: "2026-09-01T10:00:00.000Z",
			sentAt: "2026-09-01T10:00:00.000Z",
			bodyText: "Kunnen we de offerte bekijken?",
			bodyFetchedAt: "2026-09-01T10:01:00.000Z",
		})
		.returning({ id: mailMessages.id })
		.get().id;
}

describe("replies", () => {
	it("seeds a forward with nobody on it and no threading headers", async () => {
		// A forward is a new conversation. Carrying In-Reply-To would file it under
		// the thread it came from on both ends, and pre-filling a recipient would
		// be guessing at the one thing the person forwarding it is deciding.
		const originalId = storeOriginal(db);
		const forward = await outbox.replySeed(originalId, { mode: "forward" }, db);

		expect(forward.to).toEqual([]);
		expect(forward.cc).toEqual([]);
		expect(forward.subject).toBe("Fw: Offerte");
		expect(forward.quotedText).toContain("> Kunnen we de offerte bekijken?");
		expect(forward.replyToMessageId).toBeNull();
	});

	it("seeds a reply and a reply-all without the account itself, and threads the draft", async () => {
		const originalId = storeOriginal(db);
		const reply = await outbox.replySeed(originalId, { mode: "reply" }, db);
		expect(reply.to).toEqual([{ name: "Laura", address: "laura@obet.be" }]);
		expect(reply.cc).toEqual([]);
		expect(reply.subject).toBe("Re: Offerte");
		expect(reply.quotedText).toContain("> Kunnen we de offerte bekijken?");
		expect(reply.quotedText).toMatch(/^Op .* schreef Laura <laura@obet.be>:/);

		const all = await outbox.replySeed(originalId, { mode: "reply_all" }, db);
		expect(all.to.map((a) => a.address)).toEqual(["laura@obet.be", "tom@obet.be"]);
		expect(all.cc.map((a) => a.address)).toEqual(["cc@elders.be"]);

		const draft = await outbox.createDraft(
			{ accountId, to: reply.to, subject: reply.subject, bodyText: "Zeker.", replyToMessageId: originalId },
			db,
		);
		expect(draft.inReplyTo).toBe("<orig@obet.be>");
		expect(draft.threadId).not.toBeNull();
		await outbox.requestSend(draft.id, { actor: "user" }, db);
		await sender.processQueue(db);
		expect(sentMessages[0]!.message.references).toEqual(["<root@obet.be>", "<orig@obet.be>"]);
		expect(sentMessages[0]!.message.inReplyTo).toBe("<orig@obet.be>");
	});
});

describe("templates", () => {
	it("renders a template in Dutch against a client", async () => {
		const client = await clientsService.create({ name: "obet" }, db);
		await contactsService.create({ clientId: client.id, name: "Laura", email: "laura@obet.be", isPrimary: true }, db);
		const cover = await coverTemplate();
		const rendered = await templates.renderTemplate(
			{ templateId: cover.id, clientId: client.id, extras: { title: "de ontwikkelovereenkomst" } },
			db,
		);
		expect(rendered.subject).toBe("de ontwikkelovereenkomst ter ondertekening");
		expect(rendered.bodyHtml).toContain("Beste Laura,");
		expect(rendered.bodyHtml).toContain("<!doctype html>");
		expect(rendered.bodyText).toContain("Beste Laura,");
		expect(rendered.bodyText).not.toContain("<p>");
		// The owner profile is empty in a fresh install, so the sign-off is missing.
		expect(rendered.missing).toContain("owner.contactName");
	});

	it("fills and sends a template in one step, and never leaves a draft behind", async () => {
		const plain = await templates.create({ name: "Groet", subject: "Dag", bodyHtml: "<p>Beste Laura, tot snel.</p>" }, db);
		const input = { accountId, to: [{ name: null, address: "laura@obet.be" }], templateId: plain.id };

		const asPerson = await outbox.sendFromTemplate(input, { actor: "user" }, db);
		expect(asPerson.state).toBe("queued");
		expect(asPerson.bodyText).toContain("Beste Laura");

		const asAgent = await outbox.sendFromTemplate(input, { actor: "agent" }, db);
		expect(asAgent.state).toBe("pending");

		// Refused for no recipient, and for a gap the template could not fill.
		const cover = await coverTemplate();
		const before = (await outbox.list({ states: ["draft"] }, db)).length;
		await expect(outbox.sendFromTemplate({ ...input, to: [] }, { actor: "user" }, db)).rejects.toThrow(/nobody in To/);
		await expect(
			outbox.sendFromTemplate({ ...input, templateId: cover.id }, { actor: "user" }, db),
		).rejects.toThrow(/placeholder without a value/);
		expect((await outbox.list({ states: ["draft"] }, db)).length).toBe(before);
	});

	it("does not save a template as a draft", async () => {
		const cover = await coverTemplate();
		await expect(
			outbox.createDraft(
				{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "x", bodyText: "x", templateId: cover.id },
				db,
			),
		).rejects.toThrow(/cannot be saved as a draft/);
	});

	it("keeps an edited template through a re-seed", async () => {
		const cover = await coverTemplate();
		const edited = await templates.update(cover.id, { subject: "Mijn onderwerp" }, db);
		expect(edited.customisedAt).not.toBeNull();
		const result = await templates.ensureMailTemplatesSeeded(db);
		expect(result.updated).toBe(0);
		expect((await templates.get(edited.id, db))!.subject).toBe("Mijn onderwerp");
	});
});

describe("attachments", () => {
	it("attaches a document's PDF and renders one that has none", async () => {
		const client = await clientsService.create({ name: "obet" }, db);
		const pdfPath = join(dir, "offerte.pdf");
		writeFileSync(pdfPath, "%PDF-1.4 test");
		const withPdf = db
			.insert(documents)
			.values({ clientId: client.id, title: "Offerte: v1", bodyHtml: "<p>x</p>", pdfPath })
			.returning({ id: documents.id })
			.get().id;
		const withoutPdf = db
			.insert(documents)
			.values({ clientId: client.id, title: "NDA", bodyHtml: "<p>x</p>" })
			.returning({ id: documents.id })
			.get().id;

		const rendered: string[] = [];
		sender.configureMailSend({
			renderDocumentPdf: async (id) => {
				rendered.push(id);
				const path = join(dir, "nda.pdf");
				writeFileSync(path, "%PDF-1.4 rendered");
				return path;
			},
		});

		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Docs", bodyText: "Zie bijlagen.", documentIds: [withPdf, withoutPdf] },
			db,
		);
		expect(draft.attachments.map((a) => a.filename)).toEqual(["Offerte_ v1.pdf", "NDA.pdf"]);
		await outbox.requestSend(draft.id, { actor: "user" }, db);
		await sender.processQueue(db);

		expect(rendered).toEqual([withoutPdf]);
		const sent = sentMessages[0]!.message;
		expect(sent.attachments.map((a) => a.path)).toEqual([pdfPath, join(dir, "nda.pdf")]);
		expect((await outbox.get(draft.id, db))!.state).toBe("sent");
	});
});

describe("a message with no text", () => {
	it("is refused when nothing is attached, and sent when a document is", async () => {
		const bare = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Leeg", bodyText: "" },
			db,
		);
		await expect(outbox.requestSend(bare.id, { actor: "user" }, db)).rejects.toThrow(/message is empty/);

		const client = await clientsService.create({ name: "obet" }, db);
		const pdfPath = join(dir, "contract.pdf");
		writeFileSync(pdfPath, "%PDF-1.4 test");
		const documentId = db
			.insert(documents)
			.values({ clientId: client.id, title: "Contract", bodyHtml: "<p>x</p>", pdfPath })
			.returning({ id: documents.id })
			.get().id;

		const withDocument = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Contract", bodyText: "", documentIds: [documentId] },
			db,
		);
		const queued = await outbox.requestSend(withDocument.id, { actor: "user" }, db);
		expect(queued.state).toBe("queued");
	});
});

describe("a sent reply in its thread", () => {
	/** The thread the stored original sits in, and the original's id. */
	function threadOf(messageId: string): string {
		return db.select({ threadId: mailMessages.threadId }).from(mailMessages).where(eq(mailMessages.id, messageId)).get()!.threadId;
	}

	async function sentReply(originalId: string, bodyText = "Zeker."): Promise<MailOutboxMessage> {
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Re: Offerte", bodyText, replyToMessageId: originalId },
			db,
		);
		await outbox.requestSend(draft.id, { actor: "user" }, db);
		await sender.processQueue(db);
		return (await outbox.get(draft.id, db))!;
	}

	it("shows in the thread as soon as it is sent, before the Sent folder is synced", async () => {
		const originalId = storeOriginal(db);
		const reply = await sentReply(originalId);
		expect(reply.state).toBe("sent");

		const thread = (await threads.getThread(threadOf(originalId), db))!;
		expect(thread.messages).toHaveLength(1);
		expect(thread.outgoing).toHaveLength(1);
		const [shown] = thread.outgoing;
		expect(shown).toMatchObject({
			id: reply.id,
			state: "sent",
			messageId: reply.messageId,
			subject: "Re: Offerte",
			bodyText: "Zeker.",
			to: [{ name: null, address: "laura@obet.be" }],
			from: { address: "hallo@juno.test", name: "Nathan" },
		});
		expect(shown!.date).toBe(reply.sentAt);
		expect(shown!.bodyHtml).toContain("Zeker.");
	});

	it("shows a queued reply as queued", async () => {
		const originalId = storeOriginal(db);
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Re: Offerte", bodyText: "Zeker.", replyToMessageId: originalId },
			db,
		);
		await outbox.requestSend(draft.id, { actor: "user" }, db);
		const thread = (await threads.getThread(threadOf(originalId), db))!;
		expect(thread.outgoing.map((o) => o.state)).toEqual(["queued"]);
	});

	it("finds a reply by its References when the thread link is gone", async () => {
		const originalId = storeOriginal(db);
		const reply = await sentReply(originalId);
		db.update(mailOutbox).set({ threadId: null, inReplyTo: null, referencesJson: JSON.stringify(["<orig@obet.be>"]) }).where(eq(mailOutbox.id, reply.id)).run();
		const thread = (await threads.getThread(threadOf(originalId), db))!;
		expect(thread.outgoing.map((o) => o.id)).toEqual([reply.id]);
	});

	it("steps aside once a synced message with the same Message-ID is in the thread", async () => {
		const originalId = storeOriginal(db);
		const threadId = threadOf(originalId);
		const reply = await sentReply(originalId);
		expect((await threads.getThread(threadId, db))!.outgoing).toHaveLength(1);

		const sentFolder = db.select({ id: mailFolders.id }).from(mailFolders).where(eq(mailFolders.specialUse, "sent")).get()!;
		db.insert(mailMessages)
			.values({
				accountId,
				folderId: sentFolder.id,
				threadId,
				uid: 7,
				messageId: reply.messageId,
				fromAddress: "hallo@juno.test",
				toJson: JSON.stringify([{ name: null, address: "laura@obet.be" }]),
				subject: "Re: Offerte",
				snippet: "Zeker.",
				internalDate: reply.sentAt!,
				sentAt: reply.sentAt,
			})
			.run();

		const thread = (await threads.getThread(threadId, db))!;
		expect(thread.messages).toHaveLength(2);
		expect(thread.outgoing).toEqual([]);
	});

	it("does not step aside for a synced message that was deleted", async () => {
		const originalId = storeOriginal(db);
		const threadId = threadOf(originalId);
		const reply = await sentReply(originalId);
		const sentFolder = db.select({ id: mailFolders.id }).from(mailFolders).where(eq(mailFolders.specialUse, "sent")).get()!;
		db.insert(mailMessages)
			.values({
				accountId,
				folderId: sentFolder.id,
				threadId,
				uid: 7,
				messageId: reply.messageId,
				subject: "Re: Offerte",
				internalDate: reply.sentAt!,
				deletedAt: reply.sentAt,
			})
			.run();
		expect((await threads.getThread(threadId, db))!.outgoing).toHaveLength(1);
	});

	it("leaves out a message that answers a different thread", async () => {
		const originalId = storeOriginal(db);
		const otherId = storeOriginal(db, "<other@obet.be>");
		await sentReply(otherId);
		const thread = (await threads.getThread(threadOf(originalId), db))!;
		expect(thread.outgoing).toEqual([]);
	});

	it("lists drafts, waiting and failed messages, and leaves out cancelled and deleted ones", async () => {
		const originalId = storeOriginal(db);
		const threadId = threadOf(originalId);
		const make = () =>
			outbox.createDraft(
				{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Re: Offerte", bodyText: "x", replyToMessageId: originalId },
				db,
			);
		const draft = await make();
		const failed = await make();
		const cancelled = await make();
		db.update(mailOutbox).set({ state: "failed" }).where(eq(mailOutbox.id, failed.id)).run();
		await outbox.cancel(cancelled.id, db);
		const shown = (await threads.getThread(threadId, db))!.outgoing;
		expect(shown.map((o) => [o.id, o.state])).toEqual(
			expect.arrayContaining([
				[draft.id, "draft"],
				[failed.id, "failed"],
			]),
		);
		expect(shown.some((o) => o.id === cancelled.id)).toBe(false);

		const gone = await sentReply(originalId);
		expect((await threads.getThread(threadId, db))!.outgoing.some((o) => o.id === gone.id)).toBe(true);
		db.update(mailOutbox).set({ deletedAt: "2026-09-02T00:00:00.000Z" }).where(eq(mailOutbox.id, gone.id)).run();
		expect((await threads.getThread(threadId, db))!.outgoing.some((o) => o.id === gone.id)).toBe(false);
	});

	it("answers and forwards a sent message that has not synced back yet", async () => {
		const originalId = storeOriginal(db);
		const reply = await sentReply(originalId);

		const answer = await outbox.replySeedForOutgoing(reply.id, { mode: "reply" }, db);
		expect(answer).toMatchObject({
			accountId,
			to: [{ name: null, address: "laura@obet.be" }],
			subject: "Re: Offerte",
			replyToMessageId: originalId,
		});
		expect(answer.quotedText).toContain("Zeker.");

		const forward = await outbox.replySeedForOutgoing(reply.id, { mode: "forward" }, db);
		expect(forward).toMatchObject({ to: [], subject: "Fw: Re: Offerte", replyToMessageId: null });
	});

	it("refuses to answer a draft", async () => {
		const originalId = storeOriginal(db);
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Re: Offerte", bodyText: "x", replyToMessageId: originalId },
			db,
		);
		await expect(outbox.replySeedForOutgoing(draft.id, { mode: "reply" }, db)).rejects.toThrow(/has been sent/);
	});

	it("lists more than one, oldest first", async () => {
		const originalId = storeOriginal(db);
		const first = await sentReply(originalId, "Een.");
		const second = await sentReply(originalId, "Twee.");
		const thread = (await threads.getThread(threadOf(originalId), db))!;
		expect(thread.outgoing.map((o) => o.id)).toEqual([first.id, second.id]);
	});
});
