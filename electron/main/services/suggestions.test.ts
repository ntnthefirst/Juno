import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { calendarEvents, mailFolders, mailMessages, mailThreads } from "../db/schema";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import { configureSettings } from "./settings";
import * as suggestions from "./suggestions";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
// Wednesday 4 November 2026, 09:00 in the machine's own zone.
const TODAY = new Date(2026, 10, 4, 9, 0);

let db: Db;
let dir: string;
let accountId: string;
let folderId: string;
let threadId: string;

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	dir = mkdtempSync(join(tmpdir(), "juno-suggestions-"));
	configureSettings(dir);
	configureCredentialStore(new MemoryCredentialStore());
	accountId = (await accounts.create({ email: "hallo@juno.test", imapHost: "imap.juno.test", password: "x" }, db)).id;
	folderId = db
		.insert(mailFolders)
		.values({ accountId, path: "INBOX", name: "INBOX" })
		.returning()
		.get().id;
	threadId = db
		.insert(mailThreads)
		.values({
			accountId,
			subject: "Delivery, oak table",
			subjectNorm: "delivery, oak table",
			firstMessageAt: TODAY.toISOString(),
			lastMessageAt: TODAY.toISOString(),
		})
		.returning()
		.get().id;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

let uid = 0;
function message(bodyText: string, from = "janssens@klant.be"): string {
	uid += 1;
	return db
		.insert(mailMessages)
		.values({
			accountId,
			folderId,
			threadId,
			uid,
			subject: "Re: Delivery, oak table",
			fromName: "Janssens",
			fromAddress: from,
			bodyText,
			internalDate: TODAY.toISOString(),
		})
		.returning()
		.get().id;
}

describe("forMessage", () => {
	it("offers a calendar event for a day and a time, and writes nothing", async () => {
		const id = message("Kunnen we vrijdag om 10:00 leveren?");
		const found = await suggestions.forMessage(id, db, TODAY);
		expect(found).toEqual([
			{
				kind: "event",
				messageId: id,
				headline: "Janssens mentions Friday at 10:00.",
				question: 'Add "Delivery, oak table" to the calendar?',
			},
		]);
		expect(db.select().from(calendarEvents).all()).toHaveLength(0);
	});

	it("offers nothing for a message with no moment in it, or one the owner wrote", async () => {
		expect(await suggestions.forMessage(message("Bedankt voor de offerte."), db, TODAY)).toEqual([]);
		expect(await suggestions.forMessage(message("Vrijdag om 10:00", "hallo@juno.test"), db, TODAY)).toEqual([]);
	});

	it("is quiet when the source is switched off, and on by default", async () => {
		const id = message("Vrijdag om 10:00 dan.");
		expect(await suggestions.getSources()).toEqual({ calendar: true, projects: true });
		await suggestions.setSources({ calendar: false });
		expect(await suggestions.forMessage(id, db, TODAY)).toEqual([]);
		await suggestions.setSources({ calendar: true });
		expect(await suggestions.forMessage(id, db, TODAY)).toHaveLength(1);
	});
});

describe("Not now", () => {
	it("hides that suggestion for that message for good, and only that message", async () => {
		const first = message("Vrijdag om 10:00 dan.");
		const second = message("Vrijdag om 10:00 dan.");
		await suggestions.dismiss(first, "event", db);
		await suggestions.dismiss(first, "event", db);
		expect(await suggestions.forMessage(first, db, TODAY)).toEqual([]);
		// Still gone a month later, because the answer is stored and not the guess.
		expect(await suggestions.forMessage(first, db, new Date(2026, 10, 5, 9, 0))).toEqual([]);
		expect(await suggestions.forMessage(second, db, TODAY)).toHaveLength(1);
	});

	it("refuses a kind that does not exist and a message that does not", async () => {
		await expect(suggestions.dismiss(message("x"), "reminder", db)).rejects.toThrow(/not a kind of suggestion/);
		await expect(suggestions.dismiss("nope", "event", db)).rejects.toThrow(/does not exist/);
	});
});

describe("Add to calendar", () => {
	it("makes one event, and a second press does not make another", async () => {
		const id = message("Kunnen we vrijdag om 10:00 leveren?");
		const event = await suggestions.accept(id, "event", db, TODAY);
		expect(event.title).toBe("Delivery, oak table");
		expect(event.startLocal).toBe("2026-11-06T10:00:00");
		expect(db.select().from(calendarEvents).all()).toHaveLength(1);

		await expect(suggestions.accept(id, "event", db, TODAY)).rejects.toThrow(/already answered/);
		expect(db.select().from(calendarEvents).all()).toHaveLength(1);
		expect(await suggestions.forMessage(id, db, TODAY)).toEqual([]);
	});

	it("refuses when there is nothing to add, or the source is off", async () => {
		await expect(suggestions.accept(message("Hallo."), "event", db, TODAY)).rejects.toThrow(/no longer there/);
		await suggestions.setSources({ calendar: false });
		await expect(suggestions.accept(message("Vrijdag om 10:00."), "event", db, TODAY)).rejects.toThrow(/switched off/);
		expect(db.select().from(calendarEvents).all()).toHaveLength(0);
	});

	it("only accepts a calendar suggestion", async () => {
		await expect(suggestions.accept(message("Vrijdag om 10:00."), "project", db, TODAY)).rejects.toThrow(
			/Only a calendar suggestion/,
		);
	});
});
