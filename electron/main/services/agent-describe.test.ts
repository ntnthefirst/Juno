import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { AgentAction, AuditEvent } from "../../shared/types";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clients, mailAccounts, mailOutbox, mailThreads, projects } from "../db/schema";
import { describeAction, describeAudit, kindOfId } from "./agent-describe";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
});

const titleOf = (name: string) => `Title of ${name}`;

function action(toolName: string, args: Record<string, unknown>): AgentAction {
	return {
		id: "a1",
		ownerId: "o",
		createdAt: "2026-10-02T10:00:00.000Z",
		updatedAt: "2026-10-02T10:00:00.000Z",
		deletedAt: null,
		toolName,
		args,
		summary: "Whatever",
		preview: null,
		state: "pending",
		source: "mcp",
		automationRunId: null,
		expiresAt: "2026-10-03T10:00:00.000Z",
		decidedAt: null,
		executedAt: null,
		result: null,
		error: null,
	};
}

describe("what a bare id means", () => {
	it("follows the tool it is passed to, and stays silent for a row inside a client", () => {
		expect(kindOfId("mail.outbox.cancel")).toBe("mailDraft");
		expect(kindOfId("mail.send")).toBe("mailDraft");
		expect(kindOfId("clients.update")).toBe("client");
		expect(kindOfId("reminders.snooze")).toBe("reminder");
		expect(kindOfId("templates.update")).toBe("documentTemplate");
		expect(kindOfId("mail.templates.update")).toBe("mailTemplate");
		// An id passed to clients.emails.update is an email row, not a client.
		expect(kindOfId("clients.emails.update")).toBeNull();
		expect(kindOfId("search.global")).toBeNull();
	});
});

describe("describeAction", () => {
	it("names the draft behind a send, instead of its id", () => {
		const [account] = db.insert(mailAccounts).values({ label: "Nathan", email: "nathan@juno.test", imapHost: "imap.juno.test", username: "nathan", credentialKey: "k1" }).returning().all();
		const [draft] = db
			.insert(mailOutbox)
			.values({
				accountId: account!.id,
				state: "draft",
				toJson: JSON.stringify([{ name: "Laura", address: "laura@obet.be" }]),
				subject: "Offerte",
				bodyText: "Hallo.",
				messageId: "<a@juno.test>",
			})
			.returning()
			.all();

		const view = describeAction(action("mail.send", { id: draft!.id }), titleOf, db);

		expect(view.title).toBe("Title of mail.send");
		expect(view.entities).toEqual([
			{ role: "Draft", kind: "mailDraft", id: draft!.id, label: "Offerte", detail: "To Laura", gone: false },
		]);
		expect(view.fields).toEqual([]);
	});

	it("names every record an argument points at, and reads the rest as labelled values", () => {
		const [client] = db.insert(clients).values({ name: "Obet", sortName: "obet" }).returning().all();
		const [project] = db.insert(projects).values({ clientId: client!.id, name: "Website" }).returning().all();

		const view = describeAction(
			action("reminders.create", {
				title: "Send the draft",
				due_on: "2026-10-25",
				client_id: client!.id,
				project_id: project!.id,
				lead_days: 3,
				notes: null,
			}),
			titleOf,
			db,
		);

		expect(view.entities.map((e) => [e.role, e.label, e.detail])).toEqual([
			["Client", "Obet", null],
			["Project", "Website", "Obet"],
		]);
		expect(view.fields).toEqual([
			{ label: "Title", value: "Send the draft", long: false },
			{ label: "Due on", value: "25/10/2026", long: false },
			{ label: "Lead days", value: "3", long: false },
		]);
	});

	it("lists several threads and marks a record that was deleted", () => {
		const [account] = db.insert(mailAccounts).values({ label: "N", email: "n@juno.test", imapHost: "imap.juno.test", username: "n", credentialKey: "k2" }).returning().all();
		const [one] = db.insert(mailThreads).values({ accountId: account!.id, subject: "Roof", subjectNorm: "roof", firstMessageAt: "2026-10-01T10:00:00.000Z", lastMessageAt: "2026-10-01T10:00:00.000Z" }).returning().all();
		const [two] = db.insert(mailThreads).values({ accountId: account!.id, subject: "Pipes", subjectNorm: "pipes", firstMessageAt: "2026-10-01T10:00:00.000Z", lastMessageAt: "2026-10-01T10:00:00.000Z" }).returning().all();
		db.update(mailThreads).set({ deletedAt: "2026-10-02T10:00:00.000Z" }).where(eq(mailThreads.id, two!.id)).run();

		const view = describeAction(action("mail.file.trash", { thread_ids: [one!.id, two!.id, "missing"] }), titleOf, db);

		expect(view.entities.map((e) => [e.label, e.gone])).toEqual([
			["Roof", false],
			["Pipes", true],
			[null, true],
		]);
	});

	it("never shows a password, and reads addresses and long text sensibly", () => {
		const view = describeAction(
			action("mail.accounts.create", { email: "a@b.be", password: "hunter2", imap_port: 993 }),
			titleOf,
			db,
		);
		expect(view.fields.map((f) => [f.label, f.value])).toEqual([
			["Email", "a@b.be"],
			["Password", "Set, not shown"],
			["Imap port", "993"],
		]);
		expect(JSON.stringify(view)).not.toContain("hunter2");

		const mail = describeAction(
			action("mail.send_from_template", {
				to: [{ name: "Laura", address: "laura@obet.be" }, { address: "tom@obet.be" }],
				extras: { title: "de NDA" },
				document_ids: [],
			}),
			titleOf,
			db,
		);
		expect(mail.fields[0]).toEqual({ label: "To", value: "Laura <laura@obet.be>, tom@obet.be", long: false });
		expect(mail.fields[1]!.long).toBe(true);
	});
});

describe("describeAudit", () => {
	it("names what a log row touched, when the tool says what its id is", () => {
		const [client] = db.insert(clients).values({ name: "Obet", sortName: "obet" }).returning().all();
		const event = (toolName: string, entityId: string | null): AuditEvent => ({
			id: `e-${toolName}`,
			ownerId: "o",
			createdAt: "2026-10-02T10:00:00.000Z",
			updatedAt: "2026-10-02T10:00:00.000Z",
			deletedAt: null,
			actor: "agent",
			toolName,
			argsDigest: "x",
			summary: "s",
			result: "ok",
			entityType: null,
			entityId,
			actionId: null,
			error: null,
		});

		const views = describeAudit([event("clients.update", client!.id), event("clients.emails.update", "zzz"), event("search.global", null)], titleOf, db);

		expect(views[0]!.entity).toMatchObject({ kind: "client", label: "Obet" });
		expect(views[1]!.entity).toBeNull();
		expect(views[2]!.entity).toBeNull();
	});
});
