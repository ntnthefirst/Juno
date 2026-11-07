import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MENU_ICONS, parseMenuRequest, type MenuKind, type MenuRequest } from "../../shared/menu";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as calendar from "./calendar";
import * as clientEmails from "./client-emails";
import * as clients from "./clients";
import * as notes from "./notes";
import * as pages from "./pages";
import { entriesFor } from "./menu-registry";
import * as projects from "./projects";
import * as reminders from "./reminders";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
});

function ask(kind: MenuKind, id: string, context?: MenuRequest["context"]) {
	return entriesFor({ kind, id, context: context ?? null, x: 0, y: 0 }, db);
}

const ids = (entries: Awaited<ReturnType<typeof ask>>) => entries.map((entry) => entry.id);

describe("reminder menu", () => {
	it("offers Complete and the snoozes on an open reminder, and Reopen on a finished one", async () => {
		const open = await reminders.create({ title: "Chase the deposit", dueOn: "2099-01-01" }, db);
		expect(ids(await ask("reminder", open.id))).toEqual([
			"complete",
			"snooze-tomorrow",
			"snooze",
			"edit",
			"move-to-client",
			"delete",
		]);

		await reminders.complete(open.id, {}, db);
		const done = await ask("reminder", open.id);
		expect(ids(done)).not.toContain("complete");
		expect(ids(done)).not.toContain("snooze-tomorrow");
	});

	it("leaves out Move to a client once the reminder has one", async () => {
		const client = await clients.create({ name: "Obet" }, db);
		const reminder = await reminders.create({ title: "Call", dueOn: "2099-01-01", clientId: client.id }, db);
		expect(ids(await ask("reminder", reminder.id))).not.toContain("move-to-client");
	});

	it("offers nothing for a reminder that is gone", async () => {
		expect(await ask("reminder", "missing")).toEqual([]);
	});
});

describe("event and client menus", () => {
	it("labels a deadline as the project it belongs to", async () => {
		const project = await projects.create({ name: "Site" }, db);
		const entries = await ask("event", project.id, "deadline");
		expect(entries.map((entry) => entry.label)).toEqual(["Open", "Edit project", "Clear deadline"]);
	});

	it("opens, edits and deletes an event", async () => {
		const event = await calendar.create(
			{ title: "Call", startLocal: "2099-01-01T10:00", endLocal: "2099-01-01T10:30", timezone: "Europe/Brussels" },
			db,
		);
		expect(ids(await ask("event", event.id))).toEqual(["open", "edit", "duplicate-event", "delete"]);
	});

	it("puts Delete last and marks it dangerous for a client", async () => {
		const client = await clients.create({ name: "Obet" }, db);
		const entries = await ask("client", client.id);
		// No address yet, so there is nobody to send a mail to.
		expect(ids(entries)).toEqual(["open", "edit", "new-project", "new-note", "archive-client", "delete"]);
		expect(entries.at(-1)).toMatchObject({ danger: true, separatorBefore: true });
	});

	it("offers Send a mail once the client has an address, and no Open on its own page", async () => {
		const client = await clients.create({ name: "Obet" }, db);
		await clientEmails.create({ clientId: client.id, email: "info@obet.test" }, db);
		expect(ids(await ask("client", client.id))).toContain("send-mail");
		expect(ids(await ask("client", client.id, "detail"))).not.toContain("open");
	});

	it("gives every entry a picture the menu can draw", async () => {
		const client = await clients.create({ name: "Obet" }, db);
		const reminder = await reminders.create({ title: "Call", dueOn: "2099-01-01" }, db);
		for (const entry of [...(await ask("client", client.id)), ...(await ask("reminder", reminder.id)), ...(await ask("blank", "notes"))]) {
			expect(MENU_ICONS as readonly string[]).toContain(entry.icon);
		}
	});
});

describe("project, add and block menus", () => {
	it("is short in a list and complete on the project page", async () => {
		const project = await projects.create({ name: "Site" }, db);
		expect(ids(await ask("project", project.id))).toEqual(["open", "open-folder", "delete"]);

		const detail = await ask("project", project.id, "detail");
		expect(ids(detail)).toEqual(["open-folder", "copy-path", "change-folder", "archive", "delete"]);
		// Printed only on the page that handles the key.
		expect(detail.find((entry) => entry.id === "open-folder")?.accelerator).toBe("CommandOrControl+O");
	});

	it("offers the five things that can be added to a project", async () => {
		const project = await projects.create({ name: "Site" }, db);
		expect(ids(await ask("add", project.id))).toEqual(["add-mail", "add-time", "add-event", "add-file", "add-note"]);
		expect(await ask("add", "missing")).toEqual([]);
	});

	it("names the block kind in its labels and refuses anything else", async () => {
		expect((await ask("block", "outro")).map((entry) => entry.label)).toEqual([
			"Edit this outro",
			"New outro",
			"Manage intros and outros",
		]);
		expect(await ask("block", "footer")).toEqual([]);
	});
});

describe("note menu", () => {
	it("offers Pin on a note and Unpin once it is pinned, and nothing for a note that is gone", async () => {
		const note = await notes.create({ title: "Prices" }, db);
		expect(ids(await ask("note", note.id))).toEqual(["pin-note", "duplicate-note", "move-to-project", "delete"]);
		await notes.update(note.id, { pinned: true }, db);
		expect(ids(await ask("note", note.id))[0]).toBe("unpin-note");
		await notes.remove(note.id, db);
		expect(await ask("note", note.id)).toEqual([]);
	});

	it("takes Open in the default app off a page, which has no file", async () => {
		const page = await pages.create({}, db);
		expect(ids(await ask("file", page.document.id))).toEqual(["open", "delete"]);
	});

	it("starts the Notes blank menu with a note and a page", async () => {
		expect(ids(await ask("blank", "notes")).slice(0, 3)).toEqual(["new-note", "new-page", "new-event"]);
	});
});

describe("blank menu", () => {
	it("starts with what the screen is for, without repeating it", async () => {
		expect(ids(await ask("blank", "clients"))).toEqual(["new-client", "new-event", "new-reminder", "new-project"]);
		expect(ids(await ask("blank", "overview"))).toEqual(["new-event", "new-reminder", "new-client", "new-project"]);
	});

	it("gives the mail list its list actions, and Mark all read only with unread mail", async () => {
		expect(ids(await ask("blank", "mail"))).toEqual(["new-message", "sync", "select-all", "toggle-styled-mail"]);
		expect(ids(await ask("blank", "mail", "unread"))).toContain("mark-all-read");
	});

	it("offers nothing for an area that does not exist", async () => {
		expect(await ask("blank", "elsewhere")).toEqual([]);
	});
});

describe("parseMenuRequest", () => {
	const good = { kind: "client", id: "abc", x: 10.4, y: 20 };

	it("accepts a kind, a record and a position, and rounds the position", () => {
		expect(parseMenuRequest(good)).toMatchObject({ kind: "client", id: "abc", x: 10, y: 20, context: null });
	});

	it("refuses a request that carries anything but a known kind, a record and a position", () => {
		expect(() => parseMenuRequest(null)).toThrow();
		expect(() => parseMenuRequest({ ...good, kind: "shell" })).toThrow();
		expect(() => parseMenuRequest({ ...good, id: "" })).toThrow();
		expect(() => parseMenuRequest({ ...good, context: "anything" })).toThrow();
		expect(() => parseMenuRequest({ ...good, x: Number.NaN })).toThrow();
	});

	it("has no field that could carry a list of items", () => {
		const parsed = parseMenuRequest({ ...good, items: [{ label: "Format disk" }] });
		expect(Object.keys(parsed).sort()).toEqual(["context", "id", "kind", "x", "y"]);
	});
});
