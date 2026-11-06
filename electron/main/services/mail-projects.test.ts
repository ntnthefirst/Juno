/**
 * Mail and projects: a conversation filed under the job it is about, the
 * attachments that go into that job's files, and the files that go out with a
 * message about it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientsService from "./clients";
import * as documents from "./documents";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import * as outbox from "./mail-outbox";
import * as files from "./mail-outbox-files";
import * as sender from "./mail-send";
import { resolveThread } from "./mail-store";
import * as threads from "./mail-threads";
import { configureMailTransport } from "./mail-transport";
import * as assets from "./project-assets";
import { configureProjectStorage } from "./project-storage";
import * as projectsService from "./projects";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;
let run: (statement: string, ...values: unknown[]) => void;
let dir: string;
let accountId: string;

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	run = (statement, ...values) => {
		connection.prepare(statement).run(...(values as never[]));
	};
	dir = mkdtempSync(join(tmpdir(), "juno-mail-projects-"));
	configureSettings(dir);
	configureCredentialStore(new MemoryCredentialStore());
	documents.configureDocumentStorage(join(dir, "documents"));
	files.configureOutboxFiles(join(dir, "outbox"));
	mkdirSync(join(dir, "mail"), { recursive: true });
	threads.configureMailThreads(join(dir, "mail"));
	configureProjectStorage(join(dir, "projects"));
	configureMailTransport(
		{
			async verify() {
				return;
			},
			async send(_connection, message) {
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
	const stamp = "2026-10-01T09:00:00.000Z";
	run(
		"INSERT INTO mail_folders (id, owner_id, created_at, updated_at, account_id, path, name) VALUES (?, ?, ?, ?, ?, ?, ?)",
		"inbox", "owner", stamp, stamp, accountId, "INBOX", "Inbox",
	);
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** A received conversation of one message, optionally with a client and an attachment. */
function received(id: string, input: { clientId?: string | null; attachment?: { name: string; body: string } } = {}) {
	const stamp = "2026-10-02T09:00:00.000Z";
	run(
		"INSERT INTO mail_threads (id, owner_id, created_at, updated_at, account_id, subject, subject_norm, client_id, first_message_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		id, "owner", stamp, stamp, accountId, "Keuken", "keuken", input.clientId ?? null, stamp, stamp,
	);
	run(
		"INSERT INTO mail_messages (id, owner_id, created_at, updated_at, account_id, folder_id, thread_id, uid, message_id, from_address, internal_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		`${id}-msg`, "owner", stamp, stamp, accountId, "inbox", id, Math.floor(Math.random() * 1e6), `<${id}@client.test>`, "laura@obet.be", stamp,
	);
	if (input.attachment) {
		writeFileSync(join(dir, "mail", `${id}-att`), input.attachment.body);
		run(
			"INSERT INTO mail_attachments (id, owner_id, created_at, updated_at, message_id, filename, mime_type, size, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			`${id}-att`, "owner", stamp, stamp, `${id}-msg`, input.attachment.name, "image/jpeg", input.attachment.body.length, `${id}-att`,
		);
	}
}

describe("a conversation filed under a project", () => {
	it("is listed on the project, named on the thread, and leaves the thread's client alone", async () => {
		const peeters = await clientsService.create({ name: "Peeters" }, db);
		const kitchen = await projectsService.create({ name: "Keuken Peeters", clientId: peeters.id }, db);
		received("thr", { clientId: peeters.id });

		const filed = await threads.linkProject("thr", kitchen.id, db);
		expect(filed).toMatchObject({ projectId: kitchen.id, projectName: "Keuken Peeters", clientId: peeters.id });
		expect((await threads.listThreads({ projectId: kitchen.id }, db)).map((t) => t.id)).toEqual(["thr"]);

		const unfiled = await threads.linkProject("thr", null, db);
		expect(unfiled).toMatchObject({ projectId: null, clientId: peeters.id });
		expect(await threads.listThreads({ projectId: kitchen.id }, db)).toEqual([]);
	});

	it("files a supplier's conversation, which has no client, under a client's job without making it the client's", async () => {
		const peeters = await clientsService.create({ name: "Peeters" }, db);
		const kitchen = await projectsService.create({ name: "Keuken Peeters", clientId: peeters.id }, db);
		received("supplier");
		const filed = await threads.linkProject("supplier", kitchen.id, db);
		expect(filed).toMatchObject({ projectId: kitchen.id, clientId: null });
	});

	it("refuses another client's job, and takes a project of the owner's own", async () => {
		const peeters = await clientsService.create({ name: "Peeters" }, db);
		const janssens = await clientsService.create({ name: "Janssens" }, db);
		const theirs = await projectsService.create({ name: "Trap Janssens", clientId: janssens.id }, db);
		const own = await projectsService.create({ name: "Werkplaats" }, db);
		received("thr", { clientId: peeters.id });
		await expect(threads.linkProject("thr", theirs.id, db)).rejects.toThrow(/belongs to another client/);
		await expect(threads.linkProject("thr", own.id, db)).resolves.toMatchObject({ projectId: own.id });
	});

	it("gives a reply the project of the conversation it answers, and a forward too", async () => {
		const kitchen = await projectsService.create({ name: "Keuken" }, db);
		received("thr");
		await threads.linkProject("thr", kitchen.id, db);
		expect((await outbox.replySeed("thr-msg", { mode: "reply" }, db)).projectId).toBe(kitchen.id);
		expect((await outbox.replySeed("thr-msg", { mode: "forward" }, db)).projectId).toBe(kitchen.id);
		const reply = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Re: Keuken", bodyText: "Ok.", replyToMessageId: "thr-msg" },
			db,
		);
		expect(reply.projectId).toBe(kitchen.id);
	});

	it("files the conversation a message sent from a project starts, when its Sent copy syncs", async () => {
		const kitchen = await projectsService.create({ name: "Keuken" }, db);
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Offerte", bodyText: "Hallo.", projectId: kitchen.id },
			db,
		);
		const threadId = resolveThread(db, accountId, {
			messageId: draft.messageId,
			inReplyTo: null,
			references: [],
			subject: "Offerte",
			date: "2026-10-03T09:00:00.000Z",
		});
		expect((await threads.getThread(threadId, db))?.summary.projectId).toBe(kitchen.id);
	});
});

describe("attachments and a project's files", () => {
	it("copies a received attachment into the project's files, under its own name", async () => {
		const kitchen = await projectsService.create({ name: "Keuken" }, db);
		received("thr", { attachment: { name: "muur.jpg", body: "photo" } });
		const asset = await assets.addFromMailAttachment(kitchen.id, "thr-att", db);
		expect(asset).toMatchObject({ projectId: kitchen.id, fileName: "muur.jpg", storage: "managed", kind: "image" });
		expect(asset.absolutePath.endsWith("muur.jpg")).toBe(true);
		expect(readFileSync(asset.absolutePath, "utf8")).toBe("photo");
	});

	it("keeps a file from this computer as a project file once sent, when the message has a project", async () => {
		const kitchen = await projectsService.create({ name: "Keuken" }, db);
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Plan", bodyText: "Zie bijlage.", projectId: kitchen.id },
			db,
		);
		const added = await files.add(draft.id, { fileName: "plan.dxf", data: new Uint8Array(Buffer.from("drawing")) }, db);
		expect(added.files[0]!.keepsAs).toBe("project-file");
		await files.setKeep(added.files[0]!.id, true, db);
		await outbox.requestSend(draft.id, db);
		await sender.processQueue(db);

		const kept = await assets.listForProject(kitchen.id, db);
		expect(kept.map((asset) => asset.fileName)).toEqual(["plan.dxf"]);
		expect(readFileSync(kept[0]!.absolutePath, "utf8")).toBe("drawing");
		expect((await outbox.get(draft.id, db))!.files[0]!.keptAssetId).toBe(kept[0]!.id);
		expect(await documents.list({}, db)).toEqual([]);
	});

	it("sends nothing it cannot keep: another kind on a message with no project is sent only", async () => {
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Plan", bodyText: "x" },
			db,
		);
		const added = await files.add(draft.id, { fileName: "plan.dxf", data: new Uint8Array(Buffer.from("drawing")) }, db);
		expect(added.files[0]!.keepsAs).toBeNull();
		await expect(files.setKeep(added.files[0]!.id, true, db)).rejects.toThrow(/has no project/);
	});

	it("attaches a project's file as a copy that is never kept again", async () => {
		const kitchen = await projectsService.create({ name: "Keuken" }, db);
		received("thr", { attachment: { name: "muur.jpg", body: "photo" } });
		const asset = await assets.addFromMailAttachment(kitchen.id, "thr-att", db);
		const draft = await outbox.createDraft(
			{ accountId, to: [{ name: null, address: "laura@obet.be" }], subject: "Foto", bodyText: "x", projectId: kitchen.id },
			db,
		);
		const attached = await files.addFromProject(draft.id, asset.id, db);
		expect(attached.files[0]).toMatchObject({ fileName: "muur.jpg", sourceAssetId: asset.id, keepsAs: null });
		await expect(files.setKeep(attached.files[0]!.id, true, db)).rejects.toThrow(/project file already/);

		// Moving the original after attaching does not change what is sent.
		rmSync(asset.absolutePath);
		expect(existsSync(asset.absolutePath)).toBe(false);
		expect(files.toSend(draft.id, db)[0]!.filename).toBe("muur.jpg");
	});
});
