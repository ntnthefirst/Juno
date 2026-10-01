/**
 * Runs under plain Node through Vitest, not inside Electron, which is why no
 * service may import `electron`. Each test gets its own in-memory database built
 * from the committed migrations, so the tests prove the real schema.
 *
 * The migrations folder is resolved from the working directory rather than from
 * the module's own location: the main process compiles to CommonJS, where
 * `import.meta` is a compile error, and Vitest loads this file as an ES module,
 * where `__dirname` does not exist. `npx vitest run` runs from the repo root.
 */
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayoutBlock } from "../../shared/types";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { documentTemplates } from "../db/schema";
import * as addresses from "./client-addresses";
import * as clientsService from "./clients";
import * as contactsService from "./contacts";
import { compileLayout } from "./document-layout";
import * as templates from "./document-templates";
import { DOCUMENT_TEMPLATE_SEED_VERSION, exampleTemplate } from "./document-templates-seed";
import * as documents from "./documents";
import * as projectsService from "./projects";
import * as settings from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("document-templates", () => {
	it("creates a template from a name alone, as one empty page of A4 on the canvas and no review", async () => {
		const db = freshDb();
		const created = await templates.create({ name: "Test template" }, db);
		expect(created.name).toBe("Test template");
		expect(created.key).toBe("test_template");
		expect(created.reviewedAt).toBeNull();
		expect(created.layout).toBeNull();
		expect(created.canvas?.paper).toEqual({ size: "A4", orientation: "portrait" });
		expect(created.canvas?.layout.children).toHaveLength(1);
	});

	it("gives a second template with the same name a distinct key", async () => {
		const db = freshDb();
		const first = await templates.create({ name: "Test template" }, db);
		const second = await templates.create({ name: "Test template" }, db);
		expect(first.key).toBe("test_template");
		expect(second.key).toBe("test_template_2");
	});

	it("refuses an empty or whitespace name", async () => {
		const db = freshDb();
		await expect(templates.create({ name: "   " }, db)).rejects.toThrow(/needs a name/);
	});
});

/**
 * What ships as a document template: nothing, except one example on a first
 * install. The two halves of that are tested against a database that looks like
 * each kind of install, because the rule is about the difference between them.
 */
describe("the seed", () => {
	let db: Db;
	let dir: string;

	beforeEach(() => {
		db = freshDb();
		dir = mkdtempSync(join(tmpdir(), "juno-document-templates-"));
		settings.configureSettings(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const RETIRED_KEYS = ["nda", "development_agreement", "hosting_agreement", "project_scope", "addendum"];

	/**
	 * The rows the old seed wrote, as it wrote them: system rows matched by their
	 * seed key, and no version recorded anywhere. Written by hand because the
	 * definitions are no longer in the code, which is the point.
	 */
	function installTheRetiredFive(): void {
		RETIRED_KEYS.forEach((key, index) => {
			db.insert(documentTemplates)
				.values({
					seedKey: key,
					key,
					name: `Oud ${key}`,
					description: "Een oude sjabloon.",
					bodyHtml: `<h1>${key}</h1><p>{{ client.name }}</p>`,
					isSystem: true,
					sortOrder: index,
					reviewedAt: null,
				})
				.run();
		});
	}

	function allRows() {
		return db.select().from(documentTemplates).all();
	}

	describe("an install that already has the five templates", () => {
		it("keeps them exactly as they are and gets no example", async () => {
			installTheRetiredFive();
			// One edited, one hidden, so every state an owner could have left them in
			// is in the comparison.
			const [first, second] = await templates.list(db);
			await templates.update(first!.id, { bodyHtml: "<p>Mijn tekst</p>" }, db);
			db.update(documentTemplates)
				.set({ hiddenAt: "2026-05-01T09:00:00.000Z" })
				.where(eq(documentTemplates.id, second!.id))
				.run();
			const before = allRows();

			const result = await templates.ensureTemplatesSeeded(db);

			expect(result).toEqual({ created: 0, updated: 0 });
			// Same ids, same bodies, same updatedAt: the whole row, not a summary of it.
			expect(allRows()).toEqual(before);
			expect(allRows().map((row) => row.key).sort()).toEqual([...RETIRED_KEYS].sort());
			expect(await settings.getDocumentTemplateSeedVersion()).toBe(DOCUMENT_TEMPLATE_SEED_VERSION);
		});

		it("does not refresh an unedited row from the source either", async () => {
			installTheRetiredFive();
			const before = allRows();

			await templates.ensureTemplatesSeeded(db);

			// The old seed rewrote an unedited system row whenever its text changed.
			for (const row of allRows()) {
				const old = before.find((candidate) => candidate.id === row.id)!;
				expect(row.bodyHtml).toBe(old.bodyHtml);
				expect(row.updatedAt).toBe(old.updatedAt);
			}
		});

		it("still gets nothing added on every launch after that", async () => {
			installTheRetiredFive();
			await templates.ensureTemplatesSeeded(db);
			const before = allRows();

			await templates.ensureTemplatesSeeded(db);
			await templates.ensureTemplatesSeeded(db);

			expect(allRows()).toEqual(before);
		});

		it("gets no example even when it has data and the five are all gone from the list", async () => {
			installTheRetiredFive();
			for (const row of await templates.list(db)) await templates.remove(row.id, db);
			await clientsService.create({ name: "obet" }, db);

			await templates.ensureTemplatesSeeded(db);

			expect(allRows()).toHaveLength(RETIRED_KEYS.length);
			expect(await templates.list(db)).toHaveLength(0);
		});
	});

	describe("a first install", () => {
		it("gets the example, as an ordinary unreviewed template, and none of the five", async () => {
			const result = await templates.ensureTemplatesSeeded(db);

			expect(result).toEqual({ created: 1, updated: 0 });
			const list = await templates.list(db);
			expect(list).toHaveLength(1);
			const example = list[0]!;
			expect(example.name).toBe(exampleTemplate().name);
			for (const key of RETIRED_KEYS) expect(await templates.getByKey(key, db)).toBeNull();
			// The owner's from the first minute: not a system row, so nothing about
			// it is a shipped default to reset or to restore.
			expect(example.isSystem).toBe(false);
			expect(example.customisedAt).toBeNull();
			expect(allRows()[0]!.seedKey).toBeNull();
			expect(allRows()[0]!.hiddenAt).toBeNull();
			// Nobody has read it, so what it produces is a specimen.
			expect(example.reviewedAt).toBeNull();
			expect(example.language).toBe("nl-BE");
			expect(await settings.getDocumentTemplateSeedVersion()).toBe(DOCUMENT_TEMPLATE_SEED_VERSION);
		});

		it("does not add a second one on the next launch", async () => {
			await templates.ensureTemplatesSeeded(db);
			await templates.ensureTemplatesSeeded(db);
			expect(allRows()).toHaveLength(1);
		});

		it("does not bring the example back after it is deleted", async () => {
			await templates.ensureTemplatesSeeded(db);
			const [example] = await templates.list(db);
			await templates.remove(example!.id, db);
			expect(await templates.list(db)).toHaveLength(0);

			await templates.ensureTemplatesSeeded(db);

			expect(await templates.list(db)).toHaveLength(0);
		});

		it("does not bring it back either when the version marker is lost", async () => {
			await templates.ensureTemplatesSeeded(db);
			const [example] = await templates.list(db);
			await templates.remove(example!.id, db);
			await settings.setDocumentTemplateSeedVersion(0);

			await templates.ensureTemplatesSeeded(db);

			// The deleted row is still a row, and a table with a row in it is not a
			// first install.
			expect(await templates.list(db)).toHaveLength(0);
			expect(allRows()).toHaveLength(1);
		});

		it("is left alone once the owner has edited it", async () => {
			await templates.ensureTemplatesSeeded(db);
			const [example] = await templates.list(db);
			const edited = await templates.update(example!.id, { name: "Mijn overeenkomst" }, db);

			await templates.ensureTemplatesSeeded(db);

			expect((await templates.get(edited.id, db))!.name).toBe("Mijn overeenkomst");
		});

		it("is not added by a later version to an install that has been through this one", async () => {
			await templates.ensureTemplatesSeeded(db);
			const [example] = await templates.list(db);
			await templates.remove(example!.id, db);

			await templates.ensureTemplatesSeeded(db, {
				version: DOCUMENT_TEMPLATE_SEED_VERSION + 1,
				example: exampleTemplate,
			});

			expect(await templates.list(db)).toHaveLength(0);
			expect(await settings.getDocumentTemplateSeedVersion()).toBe(DOCUMENT_TEMPLATE_SEED_VERSION + 1);
		});
	});

	describe("the example", () => {
		async function example() {
			await templates.ensureTemplatesSeeded(db);
			const [row] = await templates.list(db);
			return row!;
		}

		async function ownerAndClient() {
			await settings.setOwner({
				businessName: "Juno",
				firstName: "Nathan",
				lastName: "Peeters",
				addressLine1: "Kerkstraat 1",
				postalCode: "9000",
				city: "Gent",
				vatNumber: "BE0123456789",
			});
			const client = await clientsService.create({ name: "obet", vatNumber: "BE0987654321" }, db);
			await addresses.create(
				{ clientId: client.id, addressLine1: "Stationsstraat 5", postalCode: "8000", city: "Brugge" },
				db,
			);
			await contactsService.create(
				{ clientId: client.id, name: "Laura", email: "laura@obet.be", isPrimary: true },
				db,
			);
			return client;
		}

		const EXTRAS = {
			scope: "het ontwerp en de bouw van een website",
			payment_terms: "In één keer bij oplevering",
			payment_days: "14",
		};

		it("compiles from its own page model", async () => {
			const row = await example();
			expect(row.layout).not.toBeNull();
			expect(compileLayout(row.layout!)).toBe(row.bodyHtml);
		});

		it("shows one of each part of the editor", async () => {
			const row = await example();
			const layout = row.layout!;
			const flow = layout.pages.flatMap((page) => page.blocks);
			const boxes = layout.pages.flatMap((page) => page.boxes);
			const kinds = (blocks: LayoutBlock[]) => new Set(blocks.map((block) => block.kind));

			expect(layout.pages).toHaveLength(2);
			expect(kinds(flow)).toEqual(new Set(["heading", "paragraph", "list", "table", "spacer", "divider"]));
			// Pinned to the paper: the client's address, and both signature blocks.
			expect(boxes.map((box) => box.block.kind).sort()).toEqual(["paragraph", "signature", "signature"]);
			// Every kind of placeholder a layout can carry: a value, and both forms of
			// a condition.
			expect(row.bodyHtml).toMatch(/\{\{\s*client\.name\s*\}\}/);
			expect(row.bodyHtml).toContain("{{#if project.name}}");
			expect(row.bodyHtml).toContain("{{#unless project.name}}");
			for (const path of [
				"owner.businessName",
				"client.name",
				"project.name",
				"document.issuedOn",
				"document.scope",
			]) {
				expect(row.placeholders).toContain(path);
			}
			expect(row.bodyHtml).toContain("data-signature-field");
			expect(row.bodyHtml).toContain("<table>");
		});

		it("asks for three values when it is used, and every one of them is written into the body", async () => {
			const row = await example();
			expect(row.inputs.map((input) => [input.key, input.kind, input.required])).toEqual([
				["scope", "textarea", true],
				["payment_terms", "choice", true],
				["payment_days", "number", false],
			]);
			for (const input of row.inputs) expect(row.placeholders).toContain(`document.${input.key}`);
			const terms = row.inputs.find((input) => input.key === "payment_terms")!;
			expect(terms.options).toContain(terms.defaultValue);
		});

		it("is Dutch and addresses the reader as u", async () => {
			const row = await example();
			expect(row.bodyHtml).toContain("Opdrachtgever");
			expect(row.bodyHtml).toContain("Uw medewerking");
			expect(row.bodyHtml).not.toMatch(/\bje\b|\bjouw\b/);
		});

		it("renders without a single unresolved placeholder for a client with a project", async () => {
			const client = await ownerAndClient();
			const project = await projectsService.create(
				{
					clientId: client.id,
					name: "Nieuwe website",
					description: "Een website met vijf pagina's.",
					startsOn: "2026-10-01",
					dueOn: "2026-11-14",
					agreedValueCents: 210000,
				},
				db,
			);
			const row = await example();

			const result = await documents.generate(
				{ clientId: client.id, templateId: row.id, projectId: project.id, extras: EXTRAS },
				db,
			);

			expect(result.missing).toEqual([]);
			expect(result.document.bodyHtml).not.toContain("juno-missing");
			expect(result.document.bodyHtml).not.toContain("{{");
			expect(result.document.bodyHtml).toContain("Nieuwe website");
			expect(result.document.bodyHtml).toContain("Stationsstraat 5");
			expect(result.document.bodyHtml).toContain("14/11/2026");
			expect(result.document.bodyHtml).toContain("2 100,00");
			expect(result.document.bodyHtml).toContain("Laura");
			expect(result.document.bodyHtml).toContain("het ontwerp en de bouw van een website");
			// The banner and the signing block are decided by this flag.
			expect(result.document.isSpecimen).toBe(true);
		});

		it("renders without a single unresolved placeholder for a client with no project", async () => {
			const client = await ownerAndClient();
			const row = await example();

			const result = await documents.generate({ clientId: client.id, templateId: row.id, extras: EXTRAS }, db);

			expect(result.missing).toEqual([]);
			expect(result.document.bodyHtml).toContain("Vooraf schriftelijk overeengekomen");
			expect(result.document.bodyHtml).toContain("Bij ondertekening");
		});

		it("leaves out the optional lines rather than marking them, for a client with only a name", async () => {
			await settings.setOwner({
				businessName: "Juno",
				addressLine1: "Kerkstraat 1",
				postalCode: "9000",
				city: "Gent",
			});
			const client = await clientsService.create({ name: "obet" }, db);
			const row = await example();

			const result = await documents.generate({ clientId: client.id, templateId: row.id, extras: EXTRAS }, db);

			expect(result.missing).toEqual([]);
			expect(result.document.bodyHtml).not.toContain("Ondernemingsnummer");
		});

		it("marks what it asks for as missing until it has been given", async () => {
			const client = await ownerAndClient();
			const row = await example();

			const result = await documents.generate({ clientId: client.id, templateId: row.id }, db);

			expect(result.missing).toEqual(["document.payment_days", "document.payment_terms", "document.scope"]);
		});
	});
});
