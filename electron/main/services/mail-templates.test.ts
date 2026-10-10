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
		// Every launch gives them inputs for the record values they read before
		// anything can edit them; a save that still named a record would be refused.
		await templates.adoptRecordValues(db);
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

	const typed = {
		client_name: "obet",
		contact_name: "Laura",
		sender_name: "Nathan Peeters",
		business_name: "Juno",
		address: "Kerkstraat 1, 9000 Gent",
		vat_number: "BE0123456789",
		foto: "https://www.example.com/foto.jpg",
	};

	it("previews with every value it asks for typed in", async () => {
		const row = await example();

		const preview = await templates.previewDraft({ subject: row.subject, layout: row.layout, inputs: row.inputs, extras: typed });

		expect(preview.missing).toEqual([]);
		expect(preview.subject).toBe("Voorbeeld: bericht voor obet");
		expect(preview.bodyHtml).toContain("Beste Laura,");
		expect(preview.bodyHtml).toContain("Juno");
		expect(preview.bodyHtml).toContain("Ondernemingsnummer BE0123456789");
		expect(preview.bodyHtml).toContain("Kerkstraat 1, 9000 Gent");
		expect(preview.bodyText).toContain("Beste Laura,");
	});

	it("leaves out the optional business lines rather than marking them, when they are left empty", async () => {
		const row = await example();
		const rest = { ...typed, address: "", vat_number: "" };

		const preview = await templates.previewDraft({ subject: row.subject, layout: row.layout, inputs: row.inputs, extras: rest });

		expect(preview.missing).toEqual([]);
		expect(preview.bodyHtml).not.toContain("Ondernemingsnummer");
	});

	it("reads nothing from a client or from the owner's details", async () => {
		await settings.setOwner({ businessName: "Juno", firstName: "Nathan" });
		await clientsService.create({ name: "obet" }, db);
		const row = await example();
		expect(row.placeholders.every((path) => path.startsWith("document."))).toBe(true);

		const preview = await templates.previewDraft({ subject: row.subject, layout: row.layout, inputs: row.inputs });
		expect(preview.bodyHtml).not.toContain(">Juno<");
		expect(preview.missing).toEqual(
			expect.arrayContaining(["document.business_name", "document.client_name", "document.contact_name"]),
		);
	});

	it("asks for the picture, and marks it missing until it has one", async () => {
		const row = await example();
		expect(row.inputs.find((input) => input.key === "foto")).toMatchObject({ kind: "image", required: true });
		expect(row.placeholders).toContain("document.foto");

		const preview = await templates.previewDraft({ subject: row.subject, layout: row.layout, inputs: row.inputs });
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
		expect(rich).toMatchObject({ html: expect.stringContaining("{{ document.contact_name }}") });

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

		// The business details, as inputs of its own, in the footer.
		const footerText = JSON.stringify(footer);
		for (const path of ["document.business_name", "document.sender_name", "document.address", "document.vat_number"]) {
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

describe("own inputs only", () => {
	it("refuses a template that names a record value, and says what to do instead", async () => {
		await expect(
			templates.create({ name: "Groet", subject: "Hallo", bodyHtml: "<p>Beste {{ client.contactName }}</p>" }, db),
		).rejects.toThrow(/\{\{client\.contactName\}\}.*add an input/);
	});

	it("refuses a placeholder for an input it does not declare", async () => {
		const made = await templates.create(
			{
				name: "Groet",
				subject: "Hallo {{ document.naam }}",
				bodyHtml: "<p>Beste {{ document.naam }}</p>",
				inputs: [{ key: "naam", label: "Naam", kind: "text", required: true }],
			},
			db,
		);
		await expect(templates.update(made.id, { inputs: [] }, db)).rejects.toThrow(/document\.naam/);
	});

	it("fills in what was typed, and a date as it reads in Belgium", async () => {
		const made = await templates.create(
			{
				name: "Termijn",
				subject: "Tegen {{ document.due_on }}",
				bodyHtml: "<p>Beste {{ document.naam }}</p>",
				inputs: [
					{ key: "naam", label: "Naam", kind: "text", required: true },
					{ key: "due_on", label: "Tegen", kind: "date", required: true },
				],
			},
			db,
		);
		const rendered = await templates.renderTemplate(
			{ templateId: made.id, extras: { naam: "Laura", due_on: "2026-11-14" } },
			db,
		);
		expect(rendered.missing).toEqual([]);
		expect(rendered.subject).toBe("Tegen 14/11/2026");
		expect(rendered.bodyText).toContain("Beste Laura");
	});
});

describe("adoptRecordValues", () => {
	it("gives an older template an input for every record value, with the owner's details to start from", async () => {
		await settings.setOwner({ businessName: "Juno", firstName: "Nathan", lastName: "Peeters" });
		db.insert(mailTemplates)
			.values({
				key: "oud",
				name: "Oud",
				subject: "Voor {{ client.name }}",
				bodyHtml:
					"<p>Beste {{client.contactName}}, {{ document.title }}</p>" +
					"<p>{{ owner.businessName }}{{#if owner.vatNumber}} {{ owner.vatNumber }}{{/if}}</p>",
				isSystem: false,
				sortOrder: 0,
			})
			.run();

		expect(await templates.adoptRecordValues(db)).toEqual({ converted: 1 });
		const [row] = await templates.listAll(db);

		expect(row!.subject).toBe("Voor {{ document.client_name }}");
		expect(row!.bodyHtml).toContain("{{document.client_contact_name}}");
		expect(row!.bodyHtml).toContain("{{#if document.owner_vat_number}}");
		expect(row!.placeholders.every((path) => path.startsWith("document."))).toBe(true);
		expect(row!.inputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "client_name", label: "Client name", required: true }),
				expect.objectContaining({ key: "title", label: "Title", required: true }),
				expect.objectContaining({ key: "owner_business_name", defaultValue: "Juno" }),
				expect.objectContaining({ key: "owner_vat_number", required: false }),
			]),
		);
		// Converting is not the owner reviewing it.
		expect(row!.customisedAt).toBeNull();
	});

	it("changes nothing the second time", async () => {
		installTheRetiredFour();
		expect(await templates.adoptRecordValues(db)).toEqual({ converted: 4 });
		const before = allRows().map((row) => row.updatedAt);
		expect(await templates.adoptRecordValues(db)).toEqual({ converted: 0 });
		expect(allRows().map((row) => row.updatedAt)).toEqual(before);
	});
});
