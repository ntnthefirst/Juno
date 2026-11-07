/**
 * Variables in a draft. The composer keeps them as chips, the service puts the
 * values in when the message is sent, and nothing of a chip or a brace may
 * reach a client. A variable with no value stops the send.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chipHtml, fillVariables, tokensToLabels } from "../../shared/mail-variables";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailFolders } from "../db/schema";
import * as clientsService from "./clients";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import * as outbox from "./mail-outbox";
import * as sender from "./mail-send";
import { configureMailTransport, type OutgoingMessage } from "./mail-transport";
import { configureSettings, setOwner } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;
let dir: string;
let accountId: string;
let sent: OutgoingMessage[];

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	dir = mkdtempSync(join(tmpdir(), "juno-variables-"));
	configureSettings(dir);
	configureCredentialStore(new MemoryCredentialStore());
	sent = [];
	configureMailTransport(
		{
			async verify() {
				return;
			},
			async send(_connection, message) {
				sent.push(message);
				return { raw: Buffer.from("raw"), accepted: message.to.map((a) => a.address), rejected: [] };
			},
		},
		async () => undefined,
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
	await setOwner({ firstName: "Nathan", lastName: "Peeters" });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function draftWithChips(to: { name: string | null; address: string }[]) {
	const html =
		`<div data-juno-block="intro" style="margin:0 0 16px 0;">Dag ${chipHtml("first_name")},</div>` +
		`<p>Hierbij de offerte.</p>` +
		`<div data-juno-block="outro" style="margin:16px 0 0 0;">Groeten,<br>${chipHtml("my_name")}</div>`;
	return outbox.createDraft(
		{
			accountId,
			to,
			subject: "Offerte",
			bodyText: "Dag {{first_name}},\n\nHierbij de offerte.\n\nGroeten,\n{{my_name}}",
			bodyHtml: html,
		},
		db,
	);
}

describe("fillVariables", () => {
	const values = {
		client_name: "obet",
		first_name: "Laura",
		project: "",
		date: "7 november 2026",
		my_name: "Nathan Peeters",
	};

	it("replaces chips and tokens and leaves neither behind", () => {
		const filled = fillVariables(
			{ text: "Dag {{first_name}}", html: `<p>Dag ${chipHtml("first_name")} {{my_name}}</p>` },
			values,
		);
		expect(filled.text).toBe("Dag Laura");
		expect(filled.html).toBe("<p>Dag Laura Nathan Peeters</p>");
		expect(filled.missing).toEqual([]);
	});

	it("escapes a value so it cannot add markup", () => {
		const filled = fillVariables(
			{ text: "", html: chipHtml("client_name") },
			{ ...values, client_name: "<b>x</b> & co" },
		);
		expect(filled.html).toBe("&lt;b&gt;x&lt;/b&gt; &amp; co");
	});

	it("reports a variable with no value, in either part", () => {
		expect(fillVariables({ text: "{{project}}", html: null }, values).missing).toEqual(["project"]);
		expect(fillVariables({ text: "", html: chipHtml("project") }, values).missing).toEqual(["project"]);
	});

	it("reads a token as the label of its chip", () => {
		expect(tokensToLabels("Dag {{first_name}},")).toBe("Dag First name,");
	});
});

describe("sending a draft with variables", () => {
	it("keeps the chips in the draft, so it reopens as chips", async () => {
		const draft = await draftWithChips([{ name: "Laura Janssens", address: "laura@obet.be" }]);
		expect(draft.bodyHtml).toContain('data-juno-variable="first_name"');
		const reopened = (await outbox.get(draft.id, db))!;
		expect(reopened.bodyHtml).toContain('data-juno-variable="my_name"');
		expect(reopened.bodyText).toContain("{{first_name}}");
	});

	it("sends the values, in the HTML and in the plain text, and no chip or brace", async () => {
		const draft = await draftWithChips([{ name: "Laura Janssens", address: "laura@obet.be" }]);
		await outbox.requestSend(draft.id, db);
		expect(await sender.processQueue(db)).toBe(1);
		const message = sent[0]!;
		expect(message.text).toContain("Dag Laura,");
		expect(message.text).toContain("Nathan Peeters");
		expect(message.html).toContain("Dag Laura,");
		for (const part of [message.text, message.html ?? ""]) {
			expect(part).not.toContain("{{");
			expect(part).not.toContain("}}");
			expect(part).not.toContain("data-juno-variable");
			expect(part).not.toContain("First name");
		}
	});

	it("keeps a saved draft's chips through an edit, and resolves only at the send", async () => {
		const draft = await draftWithChips([{ name: "Laura Janssens", address: "laura@obet.be" }]);
		const edited = await outbox.updateDraft(draft.id, { bodyText: draft.bodyText, bodyHtml: draft.bodyHtml }, db);
		expect(edited.bodyHtml).toContain('data-juno-variable="first_name"');
		expect(edited.bodyText).toContain("{{first_name}}");
	});

	it("writes the plain text from the chips when only the HTML was given", async () => {
		const draft = await outbox.createDraft(
			{
				accountId,
				to: [{ name: "Laura", address: "laura@obet.be" }],
				subject: "Offerte",
				bodyText: "",
				bodyHtml: `<p>Dag ${chipHtml("first_name")}</p>`,
			},
			db,
		);
		expect(draft.bodyText).toBe("Dag {{first_name}}");
		await outbox.requestSend(draft.id, db);
		await sender.processQueue(db);
		expect(sent[0]!.text).toBe("Dag Laura");
	});

	it("refuses to send when a variable has no value, and leaves the draft as it was", async () => {
		const draft = await draftWithChips([{ name: null, address: "info@obet.be" }]);
		await expect(outbox.requestSend(draft.id, db)).rejects.toThrow(/First name has no value/);
		const after = (await outbox.get(draft.id, db))!;
		expect(after.state).toBe("draft");
		expect(after.bodyHtml).toContain('data-juno-variable="first_name"');
		expect(sent).toHaveLength(0);
	});

	it("takes the client's name when the draft is filed under one", async () => {
		const client = await clientsService.create({ name: "obet" }, db);
		const draft = await outbox.createDraft(
			{
				accountId,
				to: [{ name: null, address: "info@obet.be" }],
				subject: "Offerte",
				bodyText: "Geachte {{client_name}},",
				bodyHtml: `<p>Geachte ${chipHtml("client_name")},</p>`,
			},
			db,
		);
		await outbox.updateDraft(draft.id, { clientId: client.id }, db);
		await outbox.requestSend(draft.id, db);
		await sender.processQueue(db);
		expect(sent[0]!.text).toBe("Geachte obet,");
		expect(sent[0]!.html).toContain("Geachte obet,");
	});

	it("shows the filled message when its preview is drawn, and refuses the gap there too", async () => {
		const ok = await draftWithChips([{ name: "Laura Janssens", address: "laura@obet.be" }]);
		const review = await outbox.reviewForSend(ok.id, db);
		expect(review.preview).toContain("Dag Laura,");
		expect(review.preview).not.toContain("{{");
		const gap = await draftWithChips([{ name: null, address: "info@obet.be" }]);
		await expect(outbox.reviewForSend(gap.id, db)).rejects.toThrow(/no value/);
	});
});
