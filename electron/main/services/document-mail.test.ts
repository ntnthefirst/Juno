import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { documents, mailAttachments, mailFolders, mailMessages, mailThreads } from "../db/schema";
import { describeAction } from "./agent-describe";
import * as clients from "./clients";
import { importFile } from "./document-import";
import * as fromMail from "./document-mail";
import { configureDocumentStorage } from "./documents";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import { configureMailThreads } from "./mail-threads";
import * as projects from "./projects";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const WHEN = "2026-11-04T09:00:00.000Z";

const OFFER = [
	"Offerte voor de renovatie van de keuken aan de Kerkstraat.",
	"Wij leveren en plaatsen een eiken werkblad van drie meter, een spoelbak en vier kasten.",
	"De prijs is inclusief afbraak, afvoer en plaatsing, exclusief btw.",
	"Deze offerte is dertig dagen geldig na de datum van opmaak.",
].join("\n");

let db: Db;
let dirs: string[] = [];
let mailDir: string;
let accountId: string;
let folderId: string;
let uid = 0;

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	configureSettings(tempDir("juno-docmail-settings-"));
	configureCredentialStore(new MemoryCredentialStore());
	configureDocumentStorage(tempDir("juno-docmail-docs-"));
	mailDir = tempDir("juno-docmail-mail-");
	configureMailThreads(mailDir);
	accountId = (await accounts.create({ email: "hallo@juno.test", imapHost: "imap.juno.test", password: "x" }, db)).id;
	folderId = db.insert(mailFolders).values({ accountId, path: "INBOX", name: "INBOX" }).returning().get().id;
});

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

function thread(subject: string, link: { clientId?: string; projectId?: string } = {}): string {
	return db
		.insert(mailThreads)
		.values({
			accountId,
			subject,
			subjectNorm: subject.toLowerCase(),
			clientId: link.clientId ?? null,
			projectId: link.projectId ?? null,
			firstMessageAt: WHEN,
			lastMessageAt: WHEN,
		})
		.returning()
		.get().id;
}

function message(threadId: string, bodyText = "In bijlage de stukken."): string {
	uid += 1;
	return db
		.insert(mailMessages)
		.values({
			accountId,
			folderId,
			threadId,
			uid,
			subject: "Stukken",
			fromName: "Leverancier",
			fromAddress: "info@leverancier.test",
			bodyText,
			internalDate: WHEN,
			sentAt: WHEN,
		})
		.returning()
		.get().id;
}

function attachment(messageId: string, filename: string, content: string, options: { inline?: boolean } = {}): string {
	const id = `att-${(uid += 1)}`;
	writeFileSync(join(mailDir, `${id}.bin`), content);
	db.insert(mailAttachments)
		.values({
			id,
			messageId,
			filename,
			mimeType: "text/plain",
			size: Buffer.byteLength(content),
			filePath: `${id}.bin`,
			isInline: options.inline ?? false,
		})
		.run();
	return id;
}

async function keptAlready(name: string, content: string, place: { clientId?: string; projectId?: string }) {
	return importFile({ source: { kind: "bytes", fileName: name, data: new TextEncoder().encode(content) }, ...place }, db);
}

describe("a conversation filed under a project", () => {
	it("saves new files to the project, skips the same bytes, and holds a likely version back for the person", async () => {
		const client = await clients.create({ name: "Peeters" }, db);
		const project = await projects.create({ name: "Keuken", clientId: client.id }, db);
		const existing = await keptAlready("Offerte.txt", OFFER, { projectId: project.id });
		const plan = await keptAlready("Plan.txt", "Grondplan van de keuken, schaal 1 op 50.", { projectId: project.id });

		const threadId = thread("Keuken", { clientId: client.id, projectId: project.id });
		const messageId = message(threadId);
		const fresh = attachment(messageId, "Lastenboek.txt", "Lastenboek: elektriciteit en sanitair, fase twee.");
		const same = attachment(messageId, "Plan kopie.txt", "Grondplan van de keuken, schaal 1 op 50.");
		const signed = attachment(messageId, "Offerte getekend.txt", `${OFFER}\nVoor akkoord`);
		attachment(messageId, "logo.png", "an image in the body", { inline: true });

		const before = await fromMail.forThread(threadId, db);
		expect(before.place).toMatchObject({ projectId: project.id, clientId: client.id, name: "Keuken", linked: true });
		expect(before.attachments.map((entry) => entry.fileName)).toEqual(["Lastenboek.txt", "Plan kopie.txt", "Offerte getekend.txt"]);
		expect(before.attachments.find((entry) => entry.attachmentId === same)?.document?.documentId).toBe(plan.id);
		expect(before.attachments.find((entry) => entry.attachmentId === fresh)?.document).toBeNull();

		const result = await fromMail.saveFromThread({ threadId, attachmentIds: [fresh, same, signed] }, db);
		expect(result.place).toEqual({ clientId: client.id, projectId: project.id, folderId: null });
		const byId = new Map(result.outcomes.map((outcome) => [outcome.attachmentId, outcome]));

		const saved = byId.get(fresh);
		if (saved?.status !== "saved") throw new Error(`expected saved, got ${saved?.status}`);
		expect(saved.document).toMatchObject({ title: "Lastenboek", projectId: project.id, clientId: client.id });

		expect(byId.get(same)).toMatchObject({ status: "skipped", document: { documentId: plan.id } });

		const held = byId.get(signed);
		if (held?.status !== "review") throw new Error(`expected review, got ${held?.status}`);
		expect(held.match.documentId).toBe(existing.id);
		expect(held.match.reason).toBe("text");
		// Held back means not written: the person decides between a version and a document of its own.
		expect(db.select().from(documents).where(eq(documents.title, "Offerte getekend")).all()).toHaveLength(0);

		const after = await fromMail.forThread(threadId, db);
		expect(after.attachments.find((entry) => entry.attachmentId === fresh)?.document?.documentId).toBe(saved.document.id);
	});

	it("takes every attachment that is not a document yet when none is named", async () => {
		const project = await projects.create({ name: "Badkamer" }, db);
		await keptAlready("Tegels.txt", "Tegels, zestig op zestig, mat antraciet.", { projectId: project.id });
		const threadId = thread("Badkamer", { projectId: project.id });
		const messageId = message(threadId);
		attachment(messageId, "Tegels.txt", "Tegels, zestig op zestig, mat antraciet.");
		const meetstaat = attachment(messageId, "Meetstaat.txt", "Meetstaat: wanden twaalf vierkante meter, vloer zes.");

		const result = await fromMail.saveFromThread({ threadId }, db);
		expect(result.outcomes.map((outcome) => [outcome.attachmentId, outcome.status])).toEqual([[meetstaat, "saved"]]);
	});

	it("files under the project alone when the conversation's client is someone else writing about it", async () => {
		const supplier = await clients.create({ name: "Leverancier" }, db);
		const own = await projects.create({ name: "Atelier" }, db);
		const threadId = thread("Atelier", { clientId: supplier.id, projectId: own.id });
		attachment(message(threadId), "Factuur.txt", "Levering van balken voor het atelier.");

		const result = await fromMail.saveFromThread({ threadId }, db);
		expect(result.place).toEqual({ clientId: null, projectId: own.id, folderId: null });
		expect(result.outcomes[0]?.status).toBe("saved");
	});

	it("refuses an attachment of another conversation", async () => {
		const project = await projects.create({ name: "Zolder" }, db);
		const threadId = thread("Zolder", { projectId: project.id });
		attachment(message(threadId), "Plan.txt", "Zolder, isolatie.");
		const other = attachment(message(thread("Iets anders")), "Ander.txt", "Iets anders.");

		await expect(fromMail.saveFromThread({ threadId, attachmentIds: [other] }, db)).rejects.toThrow(/not in this conversation/);
	});
});

describe("a conversation filed under nothing", () => {
	it("asks for a place, and offers the project its words name", async () => {
		await projects.create({ name: "Veranda Claes" }, db);
		const threadId = thread("Prijs");
		attachment(message(threadId, "Hierbij de prijs voor de Veranda Claes, zoals besproken."), "Prijs.txt", "Prijs van de veranda.");

		const found = await fromMail.forThread(threadId, db);
		expect(found.place).toMatchObject({ name: "Veranda Claes", linked: false });

		await expect(fromMail.saveFromThread({ threadId }, db)).rejects.toThrow(/Choose where the files go/);
	});

	it("files the conversation under the chosen project in the same call, and saves there", async () => {
		const client = await clients.create({ name: "Claes" }, db);
		const project = await projects.create({ name: "Veranda", clientId: client.id }, db);
		const threadId = thread("Prijs");
		attachment(message(threadId), "Prijs.txt", "Prijs van de veranda.");

		const result = await fromMail.saveFromThread({ threadId, projectId: project.id, linkThread: true }, db);
		expect(result.thread.projectId).toBe(project.id);
		expect(result.outcomes[0]).toMatchObject({ status: "saved", document: { projectId: project.id, clientId: client.id } });
		expect((await fromMail.forThread(threadId, db)).place).toMatchObject({ projectId: project.id, linked: true });
	});

	it("saves to Unfiled when that is the place chosen", async () => {
		const threadId = thread("Prijs");
		attachment(message(threadId), "Prijs.txt", "Prijs van de schuur.");

		const result = await fromMail.saveFromThread({ threadId, clientId: null, projectId: null, folderId: null }, db);
		expect(result.place).toEqual({ clientId: null, projectId: null, folderId: null });
		expect(result.outcomes[0]).toMatchObject({ status: "saved", document: { clientId: null, projectId: null } });
	});

	it("saves nothing when the link cannot be made", async () => {
		const mine = await clients.create({ name: "Claes" }, db);
		const theirs = await clients.create({ name: "Janssens" }, db);
		const project = await projects.create({ name: "Carport", clientId: theirs.id }, db);
		const threadId = thread("Prijs", { clientId: mine.id });
		attachment(message(threadId), "Prijs.txt", "Prijs van de carport.");

		await expect(fromMail.saveFromThread({ threadId, projectId: project.id, linkThread: true }, db)).rejects.toThrow(
			/another client/,
		);
		expect(db.select().from(documents).all()).toHaveLength(0);
	});
});

describe("a parked request to save a conversation's attachments", () => {
	it("lists every file it would save", async () => {
		const project = await projects.create({ name: "Tuin" }, db);
		const threadId = thread("Tuin", { projectId: project.id });
		const messageId = message(threadId);
		attachment(messageId, "Plan.txt", "Tuinplan.");
		attachment(messageId, "Offerte.txt", "Offerte voor de tuin.");

		const view = describeAction(
			{
				id: "a",
				ownerId: "owner",
				createdAt: WHEN,
				updatedAt: WHEN,
				deletedAt: null,
				toolName: "documents.import_from_thread",
				args: { thread_id: threadId },
				summary: "Keep the attachments",
				preview: null,
				state: "pending",
				source: "mcp",
				automationRunId: null,
				expiresAt: WHEN,
				decidedAt: null,
				executedAt: null,
				result: null,
				error: null,
			},
			() => "Keep a conversation's attachments as documents",
			db,
		);
		expect(view.fields).toContainEqual({ label: "Files", value: "Plan.txt, Offerte.txt", long: false });
	});
});
