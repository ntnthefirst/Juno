/**
 * Components for document templates (decision 65), proven through the
 * services against the real schema: the rules about cycles, review, deleting
 * and detaching, and that a component reaches the same render a template's own
 * text does, so a preview, a generated document and the PDF all show it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentCanvas, MailContainer, MailNode, TemplateInput } from "../../shared/types";
import { newPage, normaliseCanvas, DEFAULT_PAPER } from "../../shared/paper";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientsService from "./clients";
import * as components from "./document-components";
import * as assets from "./document-template-assets";
import * as templates from "./document-templates";
import * as documents from "./documents";
import { emptyContainer, newBlock } from "./mail-layout";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

// A one pixel PNG, which is all a picture has to be here.
const PIXEL = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	),
);

let db: Db;
let directory: string;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	directory = mkdtempSync(join(tmpdir(), "juno-components-"));
	assets.configureTemplateAssets(directory);
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function text(html: string): MailNode {
	return { ...newBlock("text"), html } as MailNode;
}

function picture(src: string): MailNode {
	return { ...newBlock("image"), src, alt: "Logo" } as MailNode;
}

function root(...children: MailNode[]): MailContainer {
	return { ...emptyContainer("div", "Content"), children };
}

const REFERENCE: TemplateInput = { key: "reference", label: "Reference", kind: "text", required: true };

function placement(componentId: string, values: Record<string, string> = {}): MailContainer {
	return { ...emptyContainer("div", "Letterhead"), component: { componentId, values } };
}

function canvasOf(...children: MailNode[]): DocumentCanvas {
	return normaliseCanvas({
		version: 1,
		paper: DEFAULT_PAPER,
		layout: {
			version: 2,
			width: 0,
			widthMode: "fixed",
			minHeight: 0,
			fill: null,
			fonts: [],
			customCss: null,
			children: [{ ...newPage(DEFAULT_PAPER, "Page 1"), children }],
			breakpoints: [],
		},
	});
}

async function letterhead() {
	return components.create(
		{ name: "Letterhead", root: root(text("Our reference: {{document.reference}}")), inputs: [REFERENCE] },
		db,
	);
}

describe("making a component", () => {
	it("keeps what it was given, with its inputs", async () => {
		const made = await letterhead();
		expect(made.name).toBe("Letterhead");
		expect(made.inputs.map((input) => input.key)).toEqual(["reference"]);
		expect(made.usedBy).toBe(0);
		expect((await components.list(db)).map((row) => row.id)).toEqual([made.id]);
	});

	it("refuses an empty name, and a placeholder that is not one of its inputs", async () => {
		await expect(components.create({ name: "  " }, db)).rejects.toThrow(/name/);
		await expect(
			components.create({ name: "Bad", root: root(text("Hello {{client.name}}")) }, db),
		).rejects.toThrow(/does not ask for/);
	});

	it("refuses to place a component that does not exist", async () => {
		await expect(
			components.create({ name: "Outer", root: root(placement("nope")) }, db),
		).rejects.toThrow(/no longer exists/);
	});
});

describe("a component cannot contain itself", () => {
	it("is refused when it places itself", async () => {
		const made = await letterhead();
		await expect(components.update(made.id, { root: root(placement(made.id)) }, db)).rejects.toThrow(/contain itself/);
		expect((await components.get(made.id, db))!.root.children).toHaveLength(1);
	});

	it("is refused through another component", async () => {
		const a = await components.create({ name: "A", root: root(text("a")) }, db);
		const b = await components.create({ name: "B", root: root(placement(a.id)) }, db);
		await expect(components.update(a.id, { root: root(placement(b.id)) }, db)).rejects.toThrow(/contain itself/);
		// A chain that goes nowhere back is fine.
		const c = await components.create({ name: "C", root: root(placement(b.id)) }, db);
		expect(c.root.children).toHaveLength(1);
	});
});

describe("placing one in a template", () => {
	it("shows in the render with a value typed for it", async () => {
		const made = await letterhead();
		const template = await templates.create(
			{ name: "Offerte", canvas: canvasOf(placement(made.id, { reference: "OFF-2026-14" })) },
			db,
		);

		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: template.inputs, values: {} },
			db,
		);

		expect(result.html).toContain("Our reference: OFF-2026-14");
		expect(result.missing).toEqual([]);
		// The stored body already says what the component says.
		expect(template.bodyHtml).toContain("Our reference:");
	});

	it("passes one of the template's own inputs through", async () => {
		const made = await letterhead();
		const own: TemplateInput = { key: "offer_number", label: "Offer number", kind: "text", required: true };
		const template = await templates.create(
			{
				name: "Offerte",
				canvas: canvasOf(placement(made.id, { reference: "{{document.offer_number}}" })),
				inputs: [own],
			},
			db,
		);

		const filled = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: template.inputs, values: { offer_number: "7" } },
			db,
		);
		expect(filled.html).toContain("Our reference: 7");
		expect(filled.missing).toEqual([]);

		// Unfilled, it behaves as the template's own input does: a marked gap and a name in the list.
		const empty = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: template.inputs, values: {} },
			db,
		);
		expect(empty.missing).toEqual(["document.offer_number"]);
		expect(empty.html).toContain("juno-missing");
	});

	it("marks an input the placement was never given, and asks for nothing the template did not declare", async () => {
		const made = await letterhead();
		const template = await templates.create({ name: "Offerte", canvas: canvasOf(placement(made.id)) }, db);

		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: template.inputs, values: {} },
			db,
		);

		expect(result.missing).toHaveLength(1);
		expect(result.html).toContain("juno-missing");
		expect(template.inputs).toEqual([]);
	});

	it("uses the starting value of the component's input when the placement gives none", async () => {
		const made = await components.create(
			{
				name: "Footer",
				root: root(text("Payable in {{document.days}} days")),
				inputs: [{ key: "days", label: "Days", kind: "number", required: false, defaultValue: "30" }],
			},
			db,
		);
		const template = await templates.create({ name: "T", canvas: canvasOf(placement(made.id)) }, db);
		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: template.inputs, values: {} },
			db,
		);
		expect(result.html).toContain("Payable in 30 days");
		expect(result.missing).toEqual([]);
	});

	it("escapes a value typed for it, like any other", async () => {
		const made = await letterhead();
		const template = await templates.create(
			{ name: "T", canvas: canvasOf(placement(made.id, { reference: "<b>x</b>" })) },
			db,
		);
		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: [], values: {} },
			db,
		);
		expect(result.html).toContain("&lt;b&gt;x&lt;/b&gt;");
		expect(result.html).not.toContain("<b>x</b>");
	});

	it("is drawn twice with two different values", async () => {
		const made = await letterhead();
		const template = await templates.create(
			{ name: "T", canvas: canvasOf(placement(made.id, { reference: "A1" }), placement(made.id, { reference: "B2" })) },
			db,
		);
		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: [], values: {} },
			db,
		);
		expect(result.html).toContain("Our reference: A1");
		expect(result.html).toContain("Our reference: B2");
	});

	it("can be placed inside another component", async () => {
		const inner = await letterhead();
		const outer = await components.create(
			{
				name: "Outer",
				root: root(text("Outer {{document.number}}"), placement(inner.id, { reference: "{{document.number}}" })),
				inputs: [{ key: "number", label: "Number", kind: "text", required: true }],
			},
			db,
		);
		const template = await templates.create({ name: "T", canvas: canvasOf(placement(outer.id, { number: "9" })) }, db);
		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: [], values: {} },
			db,
		);
		expect(result.html).toContain("Outer 9");
		expect(result.html).toContain("Our reference: 9");
	});

	it("refuses to save a template that places a component that is gone", async () => {
		await expect(templates.create({ name: "T", canvas: canvasOf(placement("gone")) }, db)).rejects.toThrow(
			/no longer exists/,
		);
	});
});

describe("end to end", () => {
	it("reaches a generated document, which then keeps the component as it was", async () => {
		const made = await letterhead();
		const template = await templates.create(
			{ name: "Offerte", canvas: canvasOf(placement(made.id, { reference: "R-1" })) },
			db,
		);
		const client = await clientsService.create({ name: "obet" }, db);

		const first = await documents.generate({ clientId: client.id, templateId: template.id, extras: {} }, db);
		expect(first.document.bodyHtml).toContain("Our reference: R-1");

		await components.update(made.id, { root: root(text("Changed: {{document.reference}}")) }, db);

		const frozen = await documents.get(first.document.id, db);
		expect(frozen!.bodyHtml).toContain("Our reference: R-1");
		expect(frozen!.bodyHtml).not.toContain("Changed:");

		const second = await documents.generate({ clientId: client.id, templateId: template.id, extras: {} }, db);
		expect(second.document.bodyHtml).toContain("Changed: R-1");
	});
});

describe("editing one", () => {
	it("clears the review of every template that uses it, and of no other", async () => {
		const made = await letterhead();
		const using = await templates.create({ name: "Uses", canvas: canvasOf(placement(made.id)) }, db);
		const other = await templates.create({ name: "Other" }, db);
		await templates.setReviewed(using.id, true, db);
		await templates.setReviewed(other.id, true, db);

		await components.update(made.id, { root: root(text("New words {{document.reference}}")) }, db);

		const after = (await templates.get(using.id, db))!;
		expect(after.reviewedAt).toBeNull();
		expect(after.version).toBe(using.version + 1);
		expect(after.bodyHtml).toContain("New words");
		expect((await templates.get(other.id, db))!.reviewedAt).not.toBeNull();
	});

	it("clears the review of a template that uses it through another component", async () => {
		const inner = await letterhead();
		const outer = await components.create({ name: "Outer", root: root(placement(inner.id)) }, db);
		const using = await templates.create({ name: "Uses", canvas: canvasOf(placement(outer.id)) }, db);
		await templates.setReviewed(using.id, true, db);

		await components.update(inner.id, { root: root(text("Deeper {{document.reference}}")) }, db);

		expect((await templates.get(using.id, db))!.reviewedAt).toBeNull();
	});

	it("leaves the review alone when only the name changes", async () => {
		const made = await letterhead();
		const using = await templates.create({ name: "Uses", canvas: canvasOf(placement(made.id)) }, db);
		await templates.setReviewed(using.id, true, db);

		await components.update(made.id, { name: "Briefhoofd" }, db);

		expect((await templates.get(using.id, db))!.reviewedAt).not.toBeNull();
	});
});

describe("deleting one", () => {
	it("is refused while a template places it, and says which", async () => {
		const made = await letterhead();
		await templates.create({ name: "Offerte", canvas: canvasOf(placement(made.id)) }, db);

		await expect(components.remove(made.id, db)).rejects.toThrow(/Offerte/);
		expect(await components.get(made.id, db)).not.toBeNull();
	});

	it("is refused while another component places it", async () => {
		const inner = await letterhead();
		await components.create({ name: "Outer", root: root(placement(inner.id)) }, db);
		await expect(components.remove(inner.id, db)).rejects.toThrow(/Outer/);
	});

	it("is allowed once nothing places it, and then it is soft deleted", async () => {
		const made = await letterhead();
		const template = await templates.create({ name: "Offerte", canvas: canvasOf(placement(made.id)) }, db);
		await templates.remove(template.id, db);

		const removed = await components.remove(made.id, db);

		expect(removed.deletedAt).not.toBeNull();
		expect(await components.get(made.id, db)).toBeNull();
		expect(await components.list(db)).toEqual([]);
	});
});

describe("pictures", () => {
	it("belong to the component, so a template that places it draws them", async () => {
		const made = await letterhead();
		const logo = await assets.addToComponent({ componentId: made.id, fileName: "logo.png", data: PIXEL }, db);
		await components.update(made.id, { root: root(picture(logo.token), text("{{document.reference}}")) }, db);
		const template = await templates.create({ name: "T", canvas: canvasOf(placement(made.id)) }, db);

		const result = templates.renderCanvas(
			{ templateId: template.id, canvas: template.canvas!, inputs: [], values: {} },
			db,
		);

		expect(result.html).toContain("data:image/png;base64,");
		expect(result.html).not.toContain("ontbreekt: asset");
		// The template itself holds no copy.
		expect(await assets.list(template.id, db)).toEqual([]);
	});

	it("stores the same bytes once", async () => {
		const made = await letterhead();
		const one = await assets.addToComponent({ componentId: made.id, fileName: "a.png", data: PIXEL }, db);
		const two = await assets.addToComponent({ componentId: made.id, fileName: "b.png", data: PIXEL }, db);
		expect(two.id).toBe(one.id);
	});
});

describe("detaching", () => {
	it("copies the nodes in, drops the link and keeps the pictures after the component is deleted", async () => {
		const made = await letterhead();
		const logo = await assets.addToComponent({ componentId: made.id, fileName: "logo.png", data: PIXEL }, db);
		await components.update(made.id, { root: root(picture(logo.token), text("Ref {{document.reference}}")) }, db);
		const mark = placement(made.id, { reference: "KEEP-1" });
		const template = await templates.create({ name: "T", canvas: canvasOf(mark) }, db);

		const detached = await components.detach({ templateId: template.id, nodeId: mark.id }, db);
		const page = detached.canvas.layout.children[0] as MailContainer;
		const node = page.children[0] as MailContainer;

		expect(node.component ?? null).toBeNull();
		expect(node.children).toHaveLength(2);
		// The text a placement was given is now an input of the template, with that text as its starting value.
		expect(detached.inputs).toHaveLength(1);
		expect(detached.inputs[0]!.defaultValue).toBe("KEEP-1");

		const saved = await templates.update(template.id, { canvas: detached.canvas, inputs: detached.inputs }, db);
		// Nothing places it now, so it can be deleted.
		await components.remove(made.id, db);
		const result = templates.renderCanvas(
			{
				templateId: saved.id,
				canvas: saved.canvas!,
				inputs: saved.inputs,
				values: { [detached.inputs[0]!.key]: "KEEP-1" },
			},
			db,
		);

		expect(result.html).toContain("Ref KEEP-1");
		expect(result.html).toContain("data:image/png;base64,");
		expect(result.html).not.toContain("ontbreekt");
		expect(await assets.list(template.id, db)).toHaveLength(1);
	});

	it("passes a template input through into the copy", async () => {
		const made = await letterhead();
		const own: TemplateInput = { key: "offer_number", label: "Offer", kind: "text", required: true };
		const mark = placement(made.id, { reference: "{{document.offer_number}}" });
		const template = await templates.create({ name: "T", canvas: canvasOf(mark), inputs: [own] }, db);

		const detached = await components.detach({ templateId: template.id, nodeId: mark.id }, db);

		expect(detached.inputs.map((input) => input.key)).toEqual(["offer_number"]);
		expect(JSON.stringify(detached.canvas)).toContain("{{document.offer_number}}");
	});

	it("refuses a node that is not a placed component", async () => {
		const template = await templates.create({ name: "T" }, db);
		await expect(components.detach({ templateId: template.id, nodeId: "nope" }, db)).rejects.toThrow(/not a placed component/);
	});
});
