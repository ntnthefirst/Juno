import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientEmails from "./client-emails";
import * as clients from "./clients";
import * as contacts from "./contacts";
import * as blocks from "./mail-blocks";
import * as projects from "./projects";
import * as settings from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;
let dir: string;

beforeEach(async () => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	dir = mkdtempSync(join(tmpdir(), "juno-mail-blocks-"));
	settings.configureSettings(dir);
	await settings.setOwner({ firstName: "Nathan", lastName: "Peeters" });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

async function clientWithEmail(name: string, email: string) {
	const client = await clients.create({ name }, db);
	await clientEmails.create({ clientId: client.id, email }, db);
	return client;
}

describe("the list", () => {
	it("adds to the end of its kind and keeps intros before outros", () => {
		blocks.create({ kind: "outro", name: "Closing", body: "Groeten" }, db);
		const a = blocks.create({ kind: "intro", name: "A", body: "Dag," }, db);
		const b = blocks.create({ kind: "intro", name: "B", body: "Hallo," }, db);
		expect(blocks.list(undefined, db).map((block) => block.name)).toEqual(["A", "B", "Closing"]);
		expect([a.sortOrder, b.sortOrder]).toEqual([0, 1]);
	});

	it("validates its own input", () => {
		expect(() => blocks.create({ kind: "intro", name: " ", body: "Dag" }, db)).toThrow(/name/);
		expect(() => blocks.create({ kind: "intro", name: "A", body: " " }, db)).toThrow(/text/);
		expect(() => blocks.create({ kind: "intro", name: "A", body: "Dag {{nobody}}" }, db)).toThrow(/not a variable/);
		expect(() => blocks.create({ kind: "intro", name: "A", body: "Dag", rule: "always" as never }, db)).toThrow(
			/not a rule/,
		);
		expect(() => blocks.create({ kind: "footer" as never, name: "A", body: "Dag" }, db)).toThrow(/intro or an outro/);
	});

	it("tidies the spacing inside a token and the line ends", () => {
		const block = blocks.create({ kind: "intro", name: "A", body: "Dag {{ first_name }},\r\nTot zo" }, db);
		expect(block.body).toBe("Dag {{first_name}},\nTot zo");
	});

	it("updates, and deletes softly", () => {
		const block = blocks.create({ kind: "intro", name: "A", body: "Dag," }, db);
		const changed = blocks.update(block.id, { name: "B", rule: "reply" }, db);
		expect(changed).toMatchObject({ name: "B", rule: "reply", body: "Dag," });
		blocks.remove(block.id, db);
		expect(blocks.list(undefined, db)).toEqual([]);
		expect(() => blocks.get(block.id, db)).toThrow(/does not exist/);
	});

	it("reorders one kind and refuses a list that has changed", () => {
		const a = blocks.create({ kind: "intro", name: "A", body: "a" }, db);
		const b = blocks.create({ kind: "intro", name: "B", body: "b" }, db);
		const outro = blocks.create({ kind: "outro", name: "O", body: "o" }, db);
		const order = blocks.reorder("intro", [b.id, a.id], db);
		expect(order.map((block) => block.name)).toEqual(["B", "A"]);
		expect(blocks.get(outro.id, db).sortOrder).toBe(0);
		expect(() => blocks.reorder("intro", [a.id], db)).toThrow(/every intro/i);
		expect(() => blocks.reorder("intro", [a.id, a.id], db)).toThrow(/every intro/i);
	});
});

describe("resolve", () => {
	beforeEach(() => {
		blocks.create({ kind: "intro", name: "Formal", body: "Geachte {{client_name}},", rule: "client" }, db);
		blocks.create({ kind: "intro", name: "Friendly", body: "Dag {{first_name}},", rule: "new_contact" }, db);
		blocks.create({ kind: "intro", name: "Short", body: "Dag,", rule: "reply" }, db);
		blocks.create({ kind: "intro", name: "Project", body: "Over {{project}}:", rule: "project" }, db);
		blocks.create({ kind: "intro", name: "Never", body: "Hallo", rule: "manual" }, db);
		blocks.create({ kind: "outro", name: "Kind regards", body: "Groeten,\n{{my_name}}", rule: "client" }, db);
	});

	it("gives a client its client rule, with the client's name filled in", async () => {
		await clientWithEmail("Acme BV", "info@acme.be");
		const result = await blocks.resolve({ to: [{ name: null, address: "info@acme.be" }] }, db);
		expect(result.intro?.block.name).toBe("Formal");
		expect(result.intro?.text).toBe("Geachte Acme BV,");
		expect(result.outro?.text).toBe("Groeten,\nNathan Peeters");
	});

	it("gives someone who is not a client the new contact rule", async () => {
		const result = await blocks.resolve({ to: [{ name: "Anna Smet", address: "anna@example.be" }] }, db);
		expect(result.intro).toMatchObject({ text: "Dag Anna,", block: { name: "Friendly" } });
		expect(result.outro).toBeNull();
	});

	it("gives a reply its reply rule", async () => {
		const result = await blocks.resolve({ reply: true }, db);
		expect(result.intro?.block.name).toBe("Short");
	});

	it("gives a mail linked to a project its project rule", async () => {
		const project = await projects.create({ name: "Kitchen cabinets" }, db);
		const result = await blocks.resolve({ projectId: project.id }, db);
		expect(result.intro?.text).toBe("Over Kitchen cabinets:");
	});

	it("adds nothing for a manual block, and nothing when no rule matches", async () => {
		expect(await blocks.resolve({}, db)).toEqual({ intro: null, outro: null });
	});

	it("does not match a rule whose variable has no value", async () => {
		// No display name and not a contact, so there is no first name.
		const result = await blocks.resolve({ to: [{ name: null, address: "anna@example.be" }] }, db);
		expect(result.intro).toBeNull();
		const rendered = await blocks.render(blocks.list("intro", db)[1]!.id, { to: [{ name: null, address: "anna@example.be" }] }, db);
		expect(rendered).toMatchObject({ text: "Dag ,", missing: ["first_name"] });
	});

	it("takes the first name from a contact when the address has no display name", async () => {
		const client = await clientWithEmail("Acme BV", "info@acme.be");
		await contacts.create({ clientId: client.id, name: "Jan Peeters", email: "jan@acme.be" }, db);
		const rendered = await blocks.render(
			blocks.list("intro", db)[1]!.id,
			{ to: [{ name: null, address: "jan@acme.be" }] },
			db,
		);
		expect(rendered.text).toBe("Dag Jan,");
	});

	it("lets the block higher in the list win when two match, and follows a reorder", async () => {
		await clientWithEmail("Acme BV", "info@acme.be");
		const context = { reply: true, to: [{ name: null, address: "info@acme.be" }] };
		expect((await blocks.resolve(context, db)).intro?.block.name).toBe("Formal");
		const ids = blocks.list("intro", db).map((block) => block.id);
		const short = blocks.list("intro", db).find((block) => block.name === "Short")!;
		blocks.reorder("intro", [short.id, ...ids.filter((id) => id !== short.id)], db);
		expect((await blocks.resolve(context, db)).intro?.block.name).toBe("Short");
	});

	it("skips a block with an empty variable and falls to the next one that matches", async () => {
		// A project rule above a reply rule, with a project that was deleted.
		const project = await projects.create({ name: "Gone" }, db);
		await projects.remove(project.id, db);
		const result = await blocks.resolve({ projectId: project.id, reply: true }, db);
		expect(result.intro?.block.name).toBe("Short");
	});

	it("fills the date in Dutch", async () => {
		const block = blocks.create({ kind: "outro", name: "Date", body: "{{date}}" }, db);
		const rendered = await blocks.render(block.id, {}, db);
		expect(rendered.text).toMatch(/^\d{1,2} [a-z]+ \d{4}$/);
	});
});

describe("the examples", () => {
	it("are written once on an install that has none, as ordinary rows", async () => {
		expect(await blocks.ensureMailBlocksSeeded(db)).toEqual({ created: 5 });
		const all = blocks.list(undefined, db);
		expect(all.map((block) => block.name)).toEqual(["Formal", "Friendly", "Short", "Kind regards", "Best wishes"]);
		expect(all.map((block) => block.rule)).toEqual(["client", "new_contact", "reply", "client", "manual"]);
		expect(await settings.getMailBlockSeedVersion()).toBe(blocks.MAIL_BLOCK_SEED_VERSION);
	});

	it("do not come back after the owner deletes them", async () => {
		await blocks.ensureMailBlocksSeeded(db);
		for (const block of blocks.list(undefined, db)) blocks.remove(block.id, db);
		expect(await blocks.ensureMailBlocksSeeded(db)).toEqual({ created: 0 });
		expect(blocks.list(undefined, db)).toEqual([]);
	});

	it("are not written next to blocks that already exist", async () => {
		blocks.create({ kind: "intro", name: "Mine", body: "Hoi" }, db);
		expect(await blocks.ensureMailBlocksSeeded(db)).toEqual({ created: 0 });
		expect(blocks.list(undefined, db)).toHaveLength(1);
	});
});
