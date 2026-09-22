/**
 * The outbox and the sender against a fake transport. The gate is the thing
 * under test: an agent's message must wait for a person, and the sender must
 * never see anything that did not pass through the gate.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { documents, mailFolders, mailMessages, mailThreads } from "../db/schema";
import * as clientsService from "./clients";
import * as contactsService from "./contacts";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import { htmlToText, textToHtml } from "./mail-html";
import * as outbox from "./mail-outbox";
import * as sender from "./mail-send";
import * as templates from "./mail-templates";
import {
	configureMailTransport,
	type OutgoingMessage,
	type SmtpConnection,
} from "./mail-transport";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
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
	await templates.ensureMailTemplatesSeeded(db);

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
	it("stores a text draft with an HTML twin in the house shell and a stable Message-ID", async () => {
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
		const cover = (await templates.list(db)).find((t) => t.key === "contract_cover")!;
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

describe("replies", () => {
	function storeOriginal(db: Db): string {
		const threadId = db
			.insert(mailThreads)
			.values({ accountId, subject: "Offerte", subjectNorm: "offerte", firstMessageAt: "2026-09-01T10:00:00.000Z", lastMessageAt: "2026-09-01T10:00:00.000Z" })
			.returning({ id: mailThreads.id })
			.get().id;
		const folderId = db
			.insert(mailFolders)
			.values({ accountId, path: "INBOX", name: "INBOX", specialUse: "inbox", syncEnabled: true })
			.returning({ id: mailFolders.id })
			.get().id;
		return db
			.insert(mailMessages)
			.values({
				accountId,
				folderId,
				threadId,
				uid: 1,
				messageId: "<orig@obet.be>",
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

	it("seeds a reply and a reply-all without the account itself, and threads the draft", async () => {
		const originalId = storeOriginal(db);
		const reply = await outbox.replySeed(originalId, { all: false }, db);
		expect(reply.to).toEqual([{ name: "Laura", address: "laura@obet.be" }]);
		expect(reply.cc).toEqual([]);
		expect(reply.subject).toBe("Re: Offerte");
		expect(reply.quotedText).toContain("> Kunnen we de offerte bekijken?");
		expect(reply.quotedText).toMatch(/^Op .* schreef Laura <laura@obet.be>:/);

		const all = await outbox.replySeed(originalId, { all: true }, db);
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
	it("seeds the four templates in Dutch and renders one against a client", async () => {
		const list = await templates.list(db);
		expect(list.map((t) => t.key)).toEqual(["contract_cover", "project_kickoff", "invoice_due", "hosting_renewal"]);

		const client = await clientsService.create({ name: "obet" }, db);
		await contactsService.create({ clientId: client.id, name: "Laura", email: "laura@obet.be", isPrimary: true }, db);
		const cover = list.find((t) => t.key === "contract_cover")!;
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

	it("keeps an edited template through a re-seed", async () => {
		const list = await templates.list(db);
		const edited = await templates.update(list[0]!.id, { subject: "Mijn onderwerp" }, db);
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
