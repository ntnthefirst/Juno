import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clients } from "../db/schema";
import { TOOL_ROWS } from "./agent-permissions";
import { summaryFor } from "./agent-summary";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
});

describe("the sentence for a call", () => {
	it("names the record an id points at", () => {
		const [client] = db.insert(clients).values({ name: "Obet", sortName: "obet" }).returning().all();
		expect(summaryFor("clients.update", "Update a client", { id: client!.id, notes: "x" }, db)).toBe('Change the client "Obet"');
		expect(summaryFor("clients.delete", "Delete a client", { id: client!.id }, db)).toBe('Delete the client "Obet"');
	});

	it("uses the name the agent supplied when there is no record yet", () => {
		expect(summaryFor("clients.create", "Create a client", { name: "obet" }, db)).toBe('Create the client "obet"');
		expect(summaryFor("clients.create", "Create a client", {}, db)).toBe("Create a client");
	});

	it("never carries a secret, an id or a mail body", () => {
		const text = summaryFor(
			"mail.accounts.create",
			"Add a mail account",
			{ email: "a@b.be", password: "hunter2", label: "Work" },
			db,
		);
		expect(text).toBe('Create the mail account "Work"');
		expect(summaryFor("mail.draft", "Write a draft", { subject: "Hallo", body: "geheime tekst" }, db)).toBe('Write the draft "Hallo"');
	});

	it("counts mails instead of listing ids", () => {
		expect(summaryFor("mail.file.trash_messages", "Bin mails", { message_ids: ["a", "b", "c"] }, db)).toBe("Move to the bin 3 mails");
	});

	it("falls back to the tool's title for a call it has no sentence for", () => {
		expect(summaryFor("something.odd", "Do something odd", { a: 1 }, db)).toBe("Do something odd");
	});

	it("is a plain sentence for every tool that can park", () => {
		const parkable = [...TOOL_ROWS.change, ...TOOL_ROWS.drafts, ...TOOL_ROWS.send, ...TOOL_ROWS.delete];
		expect(parkable.length).toBeGreaterThan(100);
		const args = {
			id: "0190a000-0000-7000-8000-000000000000",
			client_id: "0190a000-0000-7000-8000-000000000001",
			password: "hunter2",
			token: "tok-123",
			body: "private body text",
			message_ids: ["m1", "m2"],
		};
		for (const name of parkable) {
			const title = `Title of ${name}`;
			const text = summaryFor(name, title, args, db);
			expect(text.length, name).toBeGreaterThan(3);
			expect(text, name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
			expect(text, name).not.toMatch(/\b\w+: /);
			expect(text, name).not.toMatch(/hunter2|tok-123|private body/);
			expect(text, name).not.toMatch(/[–—!]/);
			expect(text, name).not.toContain("(");
			// Either a sentence of its own or, at worst, the tool's title: never a raw dump.
			expect(text, name).not.toBe("");
		}
	});

	it("has a sentence of its own for all but a handful of the tools that can park", () => {
		const parkable = [...TOOL_ROWS.change, ...TOOL_ROWS.drafts, ...TOOL_ROWS.send, ...TOOL_ROWS.delete];
		const plain = parkable.filter((name) => summaryFor(name, "TITLE", {}, db) === "TITLE");
		expect(plain).toEqual([]);
	});
});
