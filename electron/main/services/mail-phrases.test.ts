/**
 * Greetings, sign-offs and the rules that pick them.
 *
 * The part worth holding is `resolve`: the first enabled rule that matches
 * decides, every condition has to hold, and nothing matching adds nothing.
 * The rest is the validation and the refusals an adapter passes straight on.
 */
import { resolve as resolvePath } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailAccounts, mailFolders, mailMessages, mailThreads } from "../db/schema";
import * as clientEmails from "./client-emails";
import * as clients from "./clients";
import * as contacts from "./contacts";
import * as phrases from "./mail-phrases";

const MIGRATIONS = resolvePath(process.cwd(), "electron/main/db/migrations");
const STAMP = "2026-03-01T10:00:00.000Z";

let db: Db;
let accountA: string;
let accountB: string;

function addAccount(email: string): string {
	return db
		.insert(mailAccounts)
		.values({
			label: email,
			email,
			imapHost: "imap.example.be",
			username: email,
			credentialKey: `key-${email}`,
			createdAt: STAMP,
			updatedAt: STAMP,
		})
		.returning()
		.get().id;
}

/** Mail that arrived from an address, which is what makes a stranger a known contact. */
function receiveFrom(accountId: string, address: string): void {
	const folder = db
		.insert(mailFolders)
		.values({ accountId, path: "INBOX", name: "INBOX", createdAt: STAMP, updatedAt: STAMP })
		.returning()
		.get();
	const thread = db
		.insert(mailThreads)
		.values({
			accountId,
			subject: "Hallo",
			subjectNorm: "hallo",
			firstMessageAt: STAMP,
			lastMessageAt: STAMP,
			createdAt: STAMP,
			updatedAt: STAMP,
		})
		.returning()
		.get();
	db.insert(mailMessages)
		.values({
			accountId,
			folderId: folder.id,
			threadId: thread.id,
			uid: 1,
			fromAddress: address,
			subject: "Hallo",
			internalDate: STAMP,
			createdAt: STAMP,
			updatedAt: STAMP,
		})
		.run();
}

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	accountA = addAccount("hallo@juno.test");
	accountB = addAccount("info@juno.test");
});

async function greeting(title: string, text: string) {
	return phrases.createPhrase({ kind: "greeting", title, text }, db);
}

async function signoff(title: string, text: string) {
	return phrases.createPhrase({ kind: "signoff", title, text }, db);
}

describe("greetings and sign-offs", () => {
	it("keeps line breaks, trims the ends and lists in the order made", async () => {
		const basic = await greeting("  Basic ", "\r\nBeste,\r\nBedankt voor uw bericht.  \n");
		const other = await greeting("Warm", "Hallo,");
		await signoff("Groeten", "Met vriendelijke groeten");

		expect(basic).toMatchObject({ kind: "greeting", title: "Basic", text: "Beste,\nBedankt voor uw bericht." });
		expect((await phrases.listPhrases("greeting", db)).map((p) => p.id)).toEqual([basic.id, other.id]);
		expect(await phrases.listPhrases("signoff", db)).toHaveLength(1);
		expect(await phrases.listPhrases(undefined, db)).toHaveLength(3);
	});

	it("needs a title and a text, and a kind that exists", async () => {
		await expect(greeting("  ", "Beste,")).rejects.toThrow("Give it a title.");
		await expect(greeting("Basic", " \n ")).rejects.toThrow("Write the text.");
		await expect(
			phrases.createPhrase({ kind: "closing" as never, title: "x", text: "y" }, db),
		).rejects.toThrow("greeting or signoff");
		await expect(greeting("x".repeat(101), "Beste,")).rejects.toThrow("at most 100");
	});

	it("edits the title and the text, and nothing else", async () => {
		const basic = await greeting("Basic", "Beste,");

		const edited = await phrases.updatePhrase(basic.id, { text: "Dag," }, db);

		expect(edited).toMatchObject({ id: basic.id, kind: "greeting", title: "Basic", text: "Dag," });
		await expect(phrases.updatePhrase(basic.id, { title: " " }, db)).rejects.toThrow("Give it a title.");
		await expect(phrases.updatePhrase("nope", { title: "x" }, db)).rejects.toThrow("does not exist");
	});

	it("soft deletes one nothing uses, and stops listing it", async () => {
		const basic = await greeting("Basic", "Beste,");

		const gone = await phrases.deletePhrase(basic.id, db);

		expect(gone.deletedAt).not.toBeNull();
		expect(await phrases.listPhrases(undefined, db)).toEqual([]);
		expect(await phrases.getPhrase(basic.id, db)).toBeNull();
	});

	it("refuses to delete one a rule uses, and names the rules", async () => {
		const basic = await greeting("Basic", "Beste,");
		const closing = await signoff("Groeten", "Groeten");
		await phrases.createRule({ name: "Reply to clients", greetingId: basic.id }, db);
		await phrases.createRule({ name: "Every new mail", greetingId: basic.id, signoffId: closing.id, enabled: false }, db);

		await expect(phrases.deletePhrase(basic.id, db)).rejects.toThrow(
			"Used by the rules Reply to clients and Every new mail. Change those rules first.",
		);
		await expect(phrases.deletePhrase(closing.id, db)).rejects.toThrow(
			"Used by the rule Every new mail. Change that rule first.",
		);
		expect(await phrases.getPhrase(basic.id, db)).not.toBeNull();
	});

	it("can be deleted once the rules that used it are gone", async () => {
		const basic = await greeting("Basic", "Beste,");
		const rule = await phrases.createRule({ name: "Every new mail", greetingId: basic.id }, db);

		await phrases.deleteRule(rule.id, db);
		await phrases.deletePhrase(basic.id, db);

		expect(await phrases.listPhrases(undefined, db)).toEqual([]);
	});
});

describe("rules", () => {
	it("starts with every condition open, on, and at the bottom", async () => {
		const first = await phrases.createRule({ name: "One" }, db);
		const second = await phrases.createRule({ name: " Two " }, db);

		expect(first).toMatchObject({
			enabled: true,
			messageKind: "any",
			recipientKind: "any",
			accountId: null,
			greetingId: null,
			signoffId: null,
		});
		expect(second.name).toBe("Two");
		expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
		expect((await phrases.listRules(db)).map((r) => r.id)).toEqual([first.id, second.id]);
	});

	it("checks the conditions, the account and the phrases it points at", async () => {
		const basic = await greeting("Basic", "Beste,");
		const closing = await signoff("Groeten", "Groeten");

		await expect(phrases.createRule({ name: " " }, db)).rejects.toThrow("Give the rule a name.");
		await expect(
			phrases.createRule({ name: "x", messageKind: "draft" as never }, db),
		).rejects.toThrow("any, new, reply or forward");
		await expect(
			phrases.createRule({ name: "x", recipientKind: "vip" as never }, db),
		).rejects.toThrow("any, client, contact or other");
		await expect(phrases.createRule({ name: "x", accountId: "missing" }, db)).rejects.toThrow(
			"mail account does not exist",
		);
		await expect(phrases.createRule({ name: "x", greetingId: "missing" }, db)).rejects.toThrow(
			"greeting does not exist",
		);
		// The right phrase in the wrong slot is named for what it is.
		await expect(phrases.createRule({ name: "x", greetingId: closing.id }, db)).rejects.toThrow(
			'"Groeten" is a sign-off, not a greeting.',
		);
		await expect(phrases.createRule({ name: "x", signoffId: basic.id }, db)).rejects.toThrow(
			'"Basic" is a greeting, not a sign-off.',
		);
		expect(await phrases.listRules(db)).toEqual([]);
	});

	it("does not accept a phrase that was deleted", async () => {
		const basic = await greeting("Basic", "Beste,");
		await phrases.deletePhrase(basic.id, db);

		await expect(phrases.createRule({ name: "x", greetingId: basic.id }, db)).rejects.toThrow(
			"greeting does not exist",
		);
	});

	it("edits, switches off and clears a phrase with null", async () => {
		const basic = await greeting("Basic", "Beste,");
		const rule = await phrases.createRule({ name: "Every new mail", greetingId: basic.id }, db);

		const edited = await phrases.updateRule(
			rule.id,
			{ name: "New to clients", enabled: false, messageKind: "new", recipientKind: "client", accountId: accountA, greetingId: null },
			db,
		);

		expect(edited).toMatchObject({
			name: "New to clients",
			enabled: false,
			messageKind: "new",
			recipientKind: "client",
			accountId: accountA,
			greetingId: null,
		});
		await expect(phrases.updateRule("nope", { name: "x" }, db)).rejects.toThrow("That rule does not exist.");
	});

	it("soft deletes a rule", async () => {
		const rule = await phrases.createRule({ name: "Gone" }, db);

		await phrases.deleteRule(rule.id, db);

		expect(await phrases.listRules(db)).toEqual([]);
		expect(await phrases.getRule(rule.id, db)).toBeNull();
		await expect(phrases.deleteRule(rule.id, db)).rejects.toThrow("That rule does not exist.");
	});

	it("reorders from the list given, and only from a complete one", async () => {
		const a = await phrases.createRule({ name: "A" }, db);
		const b = await phrases.createRule({ name: "B" }, db);
		const c = await phrases.createRule({ name: "C" }, db);

		const reordered = await phrases.reorderRules([c.id, a.id, b.id], db);

		expect(reordered.map((r) => r.name)).toEqual(["C", "A", "B"]);
		expect((await phrases.listRules(db)).map((r) => r.name)).toEqual(["C", "A", "B"]);
		await expect(phrases.reorderRules([a.id, b.id], db)).rejects.toThrow("every rule once");
		await expect(phrases.reorderRules([a.id, a.id, b.id], db)).rejects.toThrow("twice");
		await expect(phrases.reorderRules([a.id, b.id, "missing"], db)).rejects.toThrow("does not exist any more");
		expect((await phrases.listRules(db)).map((r) => r.name)).toEqual(["C", "A", "B"]);
	});

	it("puts a new rule after the last one once the list has been reordered", async () => {
		const a = await phrases.createRule({ name: "A" }, db);
		const b = await phrases.createRule({ name: "B" }, db);
		await phrases.reorderRules([b.id, a.id], db);

		await phrases.createRule({ name: "C" }, db);

		expect((await phrases.listRules(db)).map((r) => r.name)).toEqual(["B", "A", "C"]);
	});
});

describe("which rule decides", () => {
	const NOBODY = { name: null, address: "stranger@example.be" };

	it("adds nothing when there are no rules", async () => {
		expect(await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db)).toEqual({
			ruleId: null,
			greeting: null,
			signoff: null,
		});
	});

	it("lets the first matching rule win, top to bottom", async () => {
		const basic = await greeting("Basic", "Beste,");
		const warm = await greeting("Warm", "Hallo,");
		const first = await phrases.createRule({ name: "First", greetingId: basic.id }, db);
		await phrases.createRule({ name: "Second", greetingId: warm.id }, db);

		const result = await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db);

		expect(result).toEqual({ ruleId: first.id, greeting: "Beste,", signoff: null });
	});

	it("follows the order set by reorderRules", async () => {
		const basic = await greeting("Basic", "Beste,");
		const warm = await greeting("Warm", "Hallo,");
		const a = await phrases.createRule({ name: "A", greetingId: basic.id }, db);
		const b = await phrases.createRule({ name: "B", greetingId: warm.id }, db);
		await phrases.reorderRules([b.id, a.id], db);

		const result = await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db);

		expect(result.greeting).toBe("Hallo,");
	});

	it("skips a disabled rule and a deleted one", async () => {
		const basic = await greeting("Basic", "Beste,");
		const warm = await greeting("Warm", "Hallo,");
		const cold = await greeting("Cold", "Geachte,");
		await phrases.createRule({ name: "Off", greetingId: basic.id, enabled: false }, db);
		const removed = await phrases.createRule({ name: "Removed", greetingId: warm.id }, db);
		await phrases.deleteRule(removed.id, db);
		const live = await phrases.createRule({ name: "Live", greetingId: cold.id }, db);

		const result = await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db);

		expect(result).toMatchObject({ ruleId: live.id, greeting: "Geachte," });
	});

	it("keeps the rule that matched even when it adds only one of the two", async () => {
		const closing = await signoff("Groeten", "Met vriendelijke groeten,\nNathan");
		const basic = await greeting("Basic", "Beste,");
		const onlyClosing = await phrases.createRule({ name: "Sign-off only", signoffId: closing.id, messageKind: "reply" }, db);
		await phrases.createRule({ name: "Everything", greetingId: basic.id }, db);

		const reply = await phrases.resolve({ accountId: accountA, mode: "reply", to: [] }, db);
		const fresh = await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db);

		expect(reply).toEqual({ ruleId: onlyClosing.id, greeting: null, signoff: "Met vriendelijke groeten,\nNathan" });
		expect(fresh.greeting).toBe("Beste,");
	});

	it("matches on what the message is", async () => {
		const basic = await greeting("Basic", "Beste,");
		await phrases.createRule({ name: "Replies", greetingId: basic.id, messageKind: "reply" }, db);

		expect((await phrases.resolve({ accountId: accountA, mode: "reply", to: [] }, db)).greeting).toBe("Beste,");
		expect((await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db)).ruleId).toBeNull();
		expect((await phrases.resolve({ accountId: accountA, mode: "forward", to: [] }, db)).ruleId).toBeNull();
	});

	it("matches on the account, and null means any", async () => {
		const basic = await greeting("Basic", "Beste,");
		const warm = await greeting("Warm", "Hallo,");
		await phrases.createRule({ name: "Only A", greetingId: basic.id, accountId: accountA }, db);
		await phrases.createRule({ name: "Any", greetingId: warm.id }, db);

		expect((await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db)).greeting).toBe("Beste,");
		expect((await phrases.resolve({ accountId: accountB, mode: "new", to: [] }, db)).greeting).toBe("Hallo,");
	});

	describe("who it goes to", () => {
		beforeEach(async () => {
			const obet = (await clients.create({ name: "Obet" }, db)).id;
			await clientEmails.create({ clientId: obet, email: "hallo@obet.be" }, db);
			await contacts.create({ clientId: obet, name: "Laura", email: "laura@obet.be" }, db);
			receiveFrom(accountA, "Kennis@Example.be");
			const client = await greeting("Client", "Beste klant,");
			const known = await greeting("Known", "Dag,");
			const other = await greeting("Other", "Goedendag,");
			await phrases.createRule({ name: "Clients", greetingId: client.id, recipientKind: "client" }, db);
			await phrases.createRule({ name: "Contacts", greetingId: known.id, recipientKind: "contact" }, db);
			await phrases.createRule({ name: "Others", greetingId: other.id, recipientKind: "other" }, db);
		});

		const pick = async (...addresses: string[]) =>
			(
				await phrases.resolve(
					{ accountId: accountA, mode: "new", to: addresses.map((address) => ({ name: null, address })) },
					db,
				)
			).greeting;

		it("calls a client's own address a client, in any case", async () => {
			expect(await pick("HALLO@obet.be")).toBe("Beste klant,");
		});

		it("calls a client's contact a client too", async () => {
			expect(await pick("laura@obet.be")).toBe("Beste klant,");
		});

		it("calls an address that has written to us a known contact", async () => {
			expect(await pick("kennis@example.be")).toBe("Dag,");
		});

		it("calls anyone else other", async () => {
			expect(await pick(NOBODY.address)).toBe("Goedendag,");
		});

		it("lets a client win over a contact and a contact over a stranger", async () => {
			expect(await pick(NOBODY.address, "kennis@example.be", "hallo@obet.be")).toBe("Beste klant,");
			expect(await pick(NOBODY.address, "kennis@example.be")).toBe("Dag,");
		});

		it("matches only a rule that does not care while there are no recipients", async () => {
			expect(await pick()).toBeNull();
			const anyone = await greeting("Anyone", "Hoi,");
			await phrases.createRule({ name: "Anyone", greetingId: anyone.id }, db);
			expect(await pick()).toBe("Hoi,");
		});

		it("classifies the recipients on their own", async () => {
			expect(await phrases.classifyRecipients([], db)).toBeNull();
			expect(await phrases.classifyRecipients(["hallo@obet.be"], db)).toBe("client");
			expect(await phrases.classifyRecipients(["kennis@example.be"], db)).toBe("contact");
			expect(await phrases.classifyRecipients([NOBODY.address], db)).toBe("other");
		});
	});

	it("needs every condition to hold at once", async () => {
		const obet = (await clients.create({ name: "Obet" }, db)).id;
		await clientEmails.create({ clientId: obet, email: "hallo@obet.be" }, db);
		const basic = await greeting("Basic", "Beste,");
		await phrases.createRule(
			{ name: "Replies to clients on A", greetingId: basic.id, messageKind: "reply", recipientKind: "client", accountId: accountA },
			db,
		);
		const to = [{ name: null, address: "hallo@obet.be" }];

		expect((await phrases.resolve({ accountId: accountA, mode: "reply", to }, db)).greeting).toBe("Beste,");
		expect((await phrases.resolve({ accountId: accountB, mode: "reply", to }, db)).ruleId).toBeNull();
		expect((await phrases.resolve({ accountId: accountA, mode: "new", to }, db)).ruleId).toBeNull();
		expect((await phrases.resolve({ accountId: accountA, mode: "reply", to: [NOBODY] }, db)).ruleId).toBeNull();
	});

	it("adds nothing when a rule's phrase is no longer there", async () => {
		const basic = await greeting("Basic", "Beste,");
		const rule = await phrases.createRule({ name: "Every new mail", greetingId: basic.id }, db);
		await phrases.updateRule(rule.id, { greetingId: null }, db);
		await phrases.deletePhrase(basic.id, db);

		expect(await phrases.resolve({ accountId: accountA, mode: "new", to: [] }, db)).toEqual({
			ruleId: rule.id,
			greeting: null,
			signoff: null,
		});
	});
});
