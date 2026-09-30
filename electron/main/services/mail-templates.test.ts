/**
 * What ships as a mail template: nothing, except one example on a first
 * install. The two halves of that are tested against a database that looks like
 * each kind of install, because the rule is about the difference between them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailContainer, MailLayout, MailNode } from "../../shared/types";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailTemplates } from "../db/schema";
import * as clientsService from "./clients";
import * as contactsService from "./contacts";
import { breakpointCss, compileLayout, fontLinks } from "./mail-layout";
import * as templates from "./mail-templates";
import { exampleTemplate, MAIL_TEMPLATE_SEED_VERSION } from "./mail-templates-seed";
import * as settings from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

let db: Db;
let dir: string;

beforeEach(() => {
	db = freshDb();
	dir = mkdtempSync(join(tmpdir(), "juno-mail-templates-"));
	settings.configureSettings(dir);
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const RETIRED_KEYS = ["contract_cover", "project_kickoff", "invoice_due", "hosting_renewal"];

/**
 * The rows the old seed wrote, as it wrote them: system rows matched by their
 * seed key, and no version recorded anywhere. Written by hand because the
 * definitions are no longer in the code, which is the point.
 */
function installTheRetiredFour(): void {
	RETIRED_KEYS.forEach((key, index) => {
		db.insert(mailTemplates)
			.values({
				seedKey: key,
				key,
				name: `Oud ${key}`,
				description: "Een oude sjabloon.",
				register: index === 1 ? "je" : "u",
				subject: `Onderwerp ${key}`,
				bodyHtml: `<p>Beste {{ client.contactName }}, ${key}</p>`,
				isSystem: true,
				sortOrder: index,
			})
			.run();
	});
}

function allRows() {
	return db.select().from(mailTemplates).all();
}

describe("an install that already has the four templates", () => {
	it("keeps them exactly as they are and gets no example", async () => {
		installTheRetiredFour();
		// One edited, one hidden, so every state an owner could have left them in
		// is in the comparison.
		const [first, second] = await templates.listAll(db);
		await templates.update(first!.id, { subject: "Mijn onderwerp" }, db);
		await templates.hide(second!.id, db);
		const before = allRows();

		const result = await templates.ensureMailTemplatesSeeded(db);

		expect(result).toEqual({ created: 0, updated: 0 });
		expect(allRows()).toEqual(before);
		expect(allRows().map((row) => row.key).sort()).toEqual([...RETIRED_KEYS].sort());
		expect(allRows().some((row) => row.key === "voorbeeld")).toBe(false);
		expect(await settings.getMailTemplateSeedVersion()).toBe(MAIL_TEMPLATE_SEED_VERSION);
	});

	it("still gets nothing added on every launch after that", async () => {
		installTheRetiredFour();
		await templates.ensureMailTemplatesSeeded(db);
		const before = allRows();

		await templates.ensureMailTemplatesSeeded(db);
		await templates.ensureMailTemplatesSeeded(db);

		expect(allRows()).toEqual(before);
	});

	it("gets no example even when it has data and the four are all gone from the list", async () => {
		installTheRetiredFour();
		for (const row of await templates.listAll(db)) await templates.hide(row.id, db);
		await clientsService.create({ name: "obet" }, db);

		await templates.ensureMailTemplatesSeeded(db);

		expect(allRows()).toHaveLength(RETIRED_KEYS.length);
	});
});

describe("a first install", () => {
	it("gets the example, laid out on a canvas, and none of the four", async () => {
		const result = await templates.ensureMailTemplatesSeeded(db);

		expect(result).toEqual({ created: 1, updated: 0 });
		const list = await templates.listAll(db);
		expect(list).toHaveLength(1);
		const example = list[0]!;
		expect(example.layout).not.toBeNull();
		expect(example.bodyHtml).toContain("Voorbeeldbericht");
		expect(list.map((row) => row.key)).not.toEqual(expect.arrayContaining(RETIRED_KEYS));
		for (const key of RETIRED_KEYS) expect(await templates.getByKey(key, db)).toBeNull();
		// The owner's from the first minute: not a system row, so nothing about it
		// is a shipped default to reset or to restore.
		expect(example.isSystem).toBe(false);
		expect(example.customisedAt).toBeNull();
		expect(example.hiddenAt).toBeNull();
		expect(allRows()[0]!.seedKey).toBeNull();
		expect(example.register).toBe("u");
		expect(example.language).toBe("nl-BE");
		expect(await settings.getMailTemplateSeedVersion()).toBe(MAIL_TEMPLATE_SEED_VERSION);
	});

	it("does not add a second one on the next launch", async () => {
		await templates.ensureMailTemplatesSeeded(db);
		await templates.ensureMailTemplatesSeeded(db);
		expect(await templates.listAll(db)).toHaveLength(1);
	});

	it("does not bring the example back after it is deleted", async () => {
		await templates.ensureMailTemplatesSeeded(db);
		const [example] = await templates.listAll(db);
		await templates.remove(example!.id, db);
		expect(await templates.listAll(db)).toHaveLength(0);

		await templates.ensureMailTemplatesSeeded(db);

		expect(await templates.listAll(db)).toHaveLength(0);
		expect(await templates.list(db)).toHaveLength(0);
	});

	it("does not bring it back either when the version marker is lost", async () => {
		await templates.ensureMailTemplatesSeeded(db);
		const [example] = await templates.listAll(db);
		await templates.remove(example!.id, db);
		await settings.setMailTemplateSeedVersion(0);

		await templates.ensureMailTemplatesSeeded(db);

		// The deleted row is still a row, and a table with a row in it is not a
		// first install.
		expect(await templates.listAll(db)).toHaveLength(0);
	});

	it("is left alone once the owner has edited it", async () => {
		await templates.ensureMailTemplatesSeeded(db);
		const [example] = await templates.listAll(db);
		const edited = await templates.update(example!.id, { subject: "Mijn onderwerp" }, db);

		await templates.ensureMailTemplatesSeeded(db);

		expect((await templates.get(edited.id, db))!.subject).toBe("Mijn onderwerp");
	});

	it("is not added by a later version to an install that has been through this one", async () => {
		await templates.ensureMailTemplatesSeeded(db);
		const [example] = await templates.listAll(db);
		await templates.remove(example!.id, db);

		await templates.ensureMailTemplatesSeeded(db, { version: MAIL_TEMPLATE_SEED_VERSION + 1, example: exampleTemplate });

		expect(await templates.listAll(db)).toHaveLength(0);
		expect(await settings.getMailTemplateSeedVersion()).toBe(MAIL_TEMPLATE_SEED_VERSION + 1);
	});
});

/** Every node of a tree, depth first. */
function walk(nodes: MailNode[], visit: (node: MailNode) => void): void {
	for (const node of nodes) {
		visit(node);
		if (node.kind === "container") walk(node.children, visit);
		if (node.kind === "columns") for (const row of node.rows) for (const cell of row.cells) walk(cell.children, visit);
	}
}

function nodesOf(layout: MailLayout): MailNode[] {
	const found: MailNode[] = [];
	walk(layout.children, (node) => found.push(node));
	return found;
}

describe("the example", () => {
	async function example() {
		await templates.ensureMailTemplatesSeeded(db);
		const [row] = await templates.listAll(db);
		return row!;
	}

	it("compiles from its own canvas", async () => {
		const row = await example();
		expect(compileLayout(row.layout!, row.inputs)).toBe(row.bodyHtml);
	});

	it("previews against a client with every value filled in", async () => {
		await settings.setOwner({
			businessName: "Juno",
			firstName: "Nathan",
			lastName: "Peeters",
			addressLine1: "Kerkstraat 1",
			postalCode: "9000",
			city: "Gent",
			vatNumber: "BE0123456789",
		});
		const client = await clientsService.create({ name: "obet" }, db);
		await contactsService.create({ clientId: client.id, name: "Laura", email: "laura@obet.be", isPrimary: true }, db);
		const row = await example();
		const extras = Object.fromEntries(row.inputs.map((input) => [input.key, input.defaultValue ?? ""]));

		const preview = await templates.previewDraft(
			{ subject: row.subject, layout: row.layout, inputs: row.inputs, clientId: client.id, extras },
			db,
		);

		expect(preview.missing).toEqual([]);
		expect(preview.subject).toBe("Voorbeeld: bericht voor obet");
		expect(preview.bodyHtml).toContain("Beste Laura,");
		expect(preview.bodyHtml).toContain("Juno");
		expect(preview.bodyHtml).toContain("Ondernemingsnummer BE0123456789");
		expect(preview.bodyHtml).toContain("Kerkstraat 1, 9000 Gent");
		expect(preview.bodyText).toContain("Beste Laura,");
	});

	it("leaves out the optional business lines rather than marking them, for an owner who left them empty", async () => {
		await settings.setOwner({ businessName: "Juno", firstName: "Nathan", lastName: "Peeters" });
		const client = await clientsService.create({ name: "obet" }, db);
		await contactsService.create({ clientId: client.id, name: "Laura", isPrimary: true }, db);
		const row = await example();

		const preview = await templates.previewDraft(
			{ subject: row.subject, layout: row.layout, inputs: row.inputs, clientId: client.id, extras: { foto: "https://www.example.com/foto.jpg" } },
			db,
		);

		expect(preview.missing).toEqual([]);
		expect(preview.bodyHtml).not.toContain("Ondernemingsnummer");
	});

	it("asks for the picture, and marks it missing until it has one", async () => {
		await settings.setOwner({ businessName: "Juno", firstName: "Nathan" });
		const row = await example();
		expect(row.inputs).toHaveLength(1);
		expect(row.inputs[0]).toMatchObject({ key: "foto", kind: "image", required: true });
		expect(row.placeholders).toContain("document.foto");

		const preview = await templates.previewDraft({ subject: row.subject, layout: row.layout, inputs: row.inputs }, db);
		expect(preview.missing).toContain("document.foto");
	});

	it("shows one of each part of the editor", async () => {
		const row = await example();
		const layout = row.layout!;
		const nodes = nodesOf(layout);
		const html = row.bodyHtml;
		const containers = nodes.filter((node): node is MailContainer => node.kind === "container");

		// A header with a logo at an https address, and a footer.
		const header = containers.find((node) => node.tag === "header");
		const footer = containers.find((node) => node.tag === "footer");
		expect(header).toBeDefined();
		expect(footer).toBeDefined();
		const logo = header!.children.find((node) => node.kind === "image");
		expect(logo).toMatchObject({ kind: "image", src: "https://www.example.com/logo.png", alt: expect.stringContaining("Logo") });
		expect(html).toContain('src="https://www.example.com/logo.png"');
		expect(html).toContain("<footer");

		// A linked Google font, used by the heading.
		expect(layout.fonts).toEqual([expect.objectContaining({ family: "Poppins", source: "google" })]);
		expect(fontLinks(layout)[0]).toContain("fonts.googleapis.com/css2?family=Poppins");
		const heading = header!.children.find((node) => node.kind === "heading");
		expect(heading).toMatchObject({ text: expect.objectContaining({ fontFamily: "Poppins" }) });
		expect(html).toContain("font-family:&#39;Poppins&#39;, Arial, Helvetica, sans-serif");

		// Rich text: bold, italic, a link and a placeholder in one block.
		const rich = nodes.find((node) => node.kind === "text" && node.html.includes("<strong>") && node.html.includes("<em>"));
		expect(rich).toBeDefined();
		expect(rich).toMatchObject({ html: expect.stringContaining("<a href=\"https://") });
		expect(rich).toMatchObject({ html: expect.stringContaining("{{ client.contactName }}") });

		// A field block for the picture the template asks for.
		expect(nodes.some((node) => node.kind === "field" && node.inputKey === "foto")).toBe(true);
		expect(html).toContain('data-juno-field="foto"');

		// Two columns across that stack into one on a phone.
		const duo = containers.find(
			(node) => node.layout.kind === "flex" && node.layout.direction === "row" && node.children.length === 2 && node.children.every((child) => child.kind === "container"),
		);
		expect(duo).toBeDefined();
		const phone = layout.breakpoints.find((entry) => entry.name === "Phone");
		expect(phone).toBeDefined();
		expect(phone!.sections[duo!.id]?.layout).toMatchObject({ kind: "flex", direction: "column" });
		expect(breakpointCss(layout, row.inputs)).toContain(`@media`);
		expect(breakpointCss(layout, row.inputs)).toContain("flex-direction:column");

		// A columns table for the comparison.
		const table = nodes.find((node) => node.kind === "columns");
		expect(table).toBeDefined();
		expect(html).toContain('role="presentation"');

		// A divider: an empty section with a height and a stroke on its bottom side.
		const divider = containers.find((node) => node.children.length === 0 && node.box.minHeight !== null && !node.box.borderSides.top && node.box.borderSides.bottom);
		expect(divider).toBeDefined();
		expect(divider!.box.borderWidth).toBeGreaterThan(0);

		// A gradient, a drop shadow, rounded corners and a colour with opacity.
		expect(html).toContain("linear-gradient(");
		expect(html).toContain("box-shadow:");
		expect(html).toContain("border-radius:");
		expect(containers.some((node) => node.box.borderColor !== null && node.box.borderColor.length === 9)).toBe(true);
		expect(html).toMatch(/rgba\(74,63,160,0\.25/);

		// A text set up as a button, with an on-click link and a hover rule.
		const button = nodes.find((node) => node.kind === "text" && node.actions.some((action) => action.trigger === "click"));
		expect(button).toBeDefined();
		expect(button).toMatchObject({ actions: expect.arrayContaining([expect.objectContaining({ trigger: "hover", change: "fill" })]) });
		expect(html).toContain('href="https://www.example.com/voorstel"');
		expect(breakpointCss(layout, row.inputs)).toMatch(/\.jb-voorbeeld-knop:hover\{[^}]*!important/);

		// A code block.
		expect(nodes.some((node) => node.kind === "html")).toBe(true);
		expect(html).toContain("VOORBEELD-001");

		// Spacing: padding and margin are both used.
		expect(containers.some((node) => node.box.margin.top > 0)).toBe(true);
		expect(containers.some((node) => node.box.padding.top > 0)).toBe(true);

		// The business details, as placeholders, in the footer.
		const footerText = JSON.stringify(footer);
		for (const path of ["owner.businessName", "owner.contactName", "owner.addressLine1", "owner.vatNumber"]) {
			expect(footerText).toContain(path);
		}
	});

	it("says in Dutch that it is an example to adapt, first", async () => {
		const row = await example();
		const first = nodesOf(row.layout!).find((node) => node.kind === "text");
		expect(first).toMatchObject({ html: expect.stringMatching(/voorbeeld.*editor.*Pas het aan/i) });
		expect(row.subject.toLowerCase()).toContain("voorbeeld");
	});
});
