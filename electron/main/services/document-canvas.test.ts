/**
 * Document templates on the canvas: the paper, the pages, what a canvas
 * template may fill in, its pictures, and a Word file read into one.
 *
 * Runs under Electron's Node like every service test, against an in-memory
 * database built from the committed migrations and a throwaway assets folder.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetKey, emptyCanvas, newPage, normaliseCanvas, PAGE_GAP, paperPx, withPaper } from "../../shared/paper";
import type { DocumentCanvas, MailBlock, MailContainer, TemplateInput } from "../../shared/types";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientsService from "./clients";
import { compileCanvas, foreignPlaceholders, parseCanvas, serialiseCanvas } from "./document-canvas";
import { canvasFromHtml, fieldKey, importDocx } from "./document-docx";
import * as assets from "./document-template-assets";
import * as templates from "./document-templates";
import * as documents from "./documents";
import { newBlock } from "./mail-layout";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

/** A PNG of one transparent pixel. */
const PIXEL = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	),
);

function text(html: string): MailBlock {
	return { ...newBlock("text"), html } as MailBlock;
}

function image(src: string): MailBlock {
	return { ...newBlock("image"), src } as MailBlock;
}

function canvasWith(...blocks: MailBlock[]): DocumentCanvas {
	const canvas = emptyCanvas();
	const page = canvas.layout.children[0] as MailContainer;
	return { ...canvas, layout: { ...canvas.layout, children: [{ ...page, children: blocks }] } };
}

const SCOPE: TemplateInput = { key: "scope", label: "Scope", kind: "textarea", required: true };
const LOGO: TemplateInput = { key: "logo", label: "Logo", kind: "image", required: false };

let dir = "";
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "juno-assets-"));
	assets.configureTemplateAssets(dir);
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("paper", () => {
	it("draws A4 at the paper's size in pixels, and turns it for landscape", () => {
		expect(paperPx({ size: "A4", orientation: "portrait" })).toEqual({ width: 794, height: 1123 });
		expect(paperPx({ size: "A4", orientation: "landscape" })).toEqual({ width: 1123, height: 794 });
		expect(paperPx({ size: "A5", orientation: "portrait" })).toEqual({ width: 559, height: 794 });
	});

	it("makes every top-level container a page of the paper, and keeps the author's margin", () => {
		const canvas = emptyCanvas();
		const page = canvas.layout.children[0] as MailContainer;
		const squeezed = { ...page, box: { ...page.box, width: 100, minHeight: 50, padding: { top: 10, right: 10, bottom: 10, left: 10 } } };
		const fixed = normaliseCanvas({ ...canvas, layout: { ...canvas.layout, children: [squeezed] } });
		const out = fixed.layout.children[0] as MailContainer;
		expect(out.box.width).toBe(794);
		expect(out.box.minHeight).toBe(1123);
		expect(out.box.clip).toBe(true);
		expect(out.box.margin.bottom).toBe(PAGE_GAP);
		expect(out.box.padding.top).toBe(10);
		expect(fixed.layout.width).toBe(794);
		expect(fixed.layout.breakpoints).toEqual([]);
	});

	it("puts a block sent at the top level onto the page before it, rather than losing it", () => {
		const canvas = emptyCanvas();
		const stray = text("Los");
		const fixed = normaliseCanvas({ ...canvas, layout: { ...canvas.layout, children: [...canvas.layout.children, stray] } });
		expect(fixed.layout.children).toHaveLength(1);
		expect((fixed.layout.children[0] as MailContainer).children.map((node) => node.id)).toEqual([stray.id]);
	});

	it("resizes every page when the paper changes", () => {
		const canvas = emptyCanvas();
		const two = { ...canvas, layout: { ...canvas.layout, children: [...canvas.layout.children, newPage(canvas.paper)] } };
		const a5 = withPaper(two, { size: "A5", orientation: "landscape" });
		for (const page of a5.layout.children as MailContainer[]) {
			expect(page.box.width).toBe(794);
			expect(page.box.minHeight).toBe(559);
		}
	});

	it("reads back what it stored, and nothing from a broken column", () => {
		const canvas = canvasWith(text("Hallo"));
		expect(parseCanvas(serialiseCanvas(canvas))).toEqual(canvas);
		expect(parseCanvas("{not json")).toBeNull();
		expect(parseCanvas(null)).toBeNull();
	});
});

describe("compiling a canvas for print", () => {
	it("sets the page to the paper, with no margin, and prints each page at its size in millimetres", () => {
		const canvas = withPaper(canvasWith(text("Hallo")), { size: "A5", orientation: "portrait" });
		const twoPages = { ...canvas, layout: { ...canvas.layout, children: [...canvas.layout.children, newPage(canvas.paper)] } };
		const html = compileCanvas(twoPages);
		expect(html).toContain("@page{size:148mm 210mm;margin:0}");
		expect(html.match(/width:148mm;height:210mm/g)).toHaveLength(2);
		// A break after every page but the last, so no blank sheet at the end.
		expect(html.match(/break-after:page/g)).toHaveLength(1);
		expect(html).toContain("break-after:auto");
		expect(html).not.toContain(`margin-bottom:${PAGE_GAP}px`);
	});
});

describe("a canvas template fills in its own inputs and nothing else", () => {
	it("names every placeholder that is not one of its inputs or pictures", () => {
		const body = "{{document.scope}} {{client.name}} {{document.other}} {{asset.abc123}} {{owner.businessName}}";
		expect(foreignPlaceholders(body, [SCOPE])).toEqual(["client.name", "document.other", "owner.businessName"]);
	});

	it("refuses to save a canvas that takes a value from a record", async () => {
		const db = freshDb();
		await expect(
			templates.create({ name: "Brief", canvas: canvasWith(text("Beste {{client.name}}")) }, db),
		).rejects.toThrow(/\{\{client\.name\}\}.*does not ask for/);
	});

	it("saves one that asks for what it uses, and compiles its body from the canvas", async () => {
		const db = freshDb();
		const created = await templates.create(
			{ name: "Brief", canvas: canvasWith(text("Omvang: {{document.scope}}")), inputs: [SCOPE] },
			db,
		);
		expect(created.canvas).not.toBeNull();
		expect(created.bodyHtml).toContain("juno-sheets");
		expect(created.placeholders).toEqual(["document.scope"]);
	});

	it("generates a document from typed values only, even for a client with every detail filled in", async () => {
		const db = freshDb();
		const client = await clientsService.create({ name: "Acme" }, db);
		const template = await templates.create(
			{ name: "Brief", canvas: canvasWith(text("Omvang: {{document.scope}}")), inputs: [SCOPE] },
			db,
		);
		const result = await documents.generate(
			{ clientId: client.id, templateId: template.id, extras: { scope: "Een nieuwe website" } },
			db,
		);
		expect(result.missing).toEqual([]);
		expect(result.document.bodyHtml).toContain("Omvang: Een nieuwe website");
		expect(result.document.bodyHtml).not.toContain("Acme");
	});

	it("marks an empty input as missing", async () => {
		const db = freshDb();
		const template = await templates.create(
			{ name: "Brief", canvas: canvasWith(text("{{document.scope}}")), inputs: [SCOPE] },
			db,
		);
		const result = await templates.fillCanvas({ templateId: template.id, values: {} }, db);
		expect(result.missing).toEqual(["document.scope"]);
		expect(result.html).toContain("[ontbreekt: document.scope]");
	});

	it("draws a picture input from its bytes, and a marked picture for an address or nothing", async () => {
		const db = freshDb();
		const field = { ...newBlock("field"), inputKey: "logo" } as MailBlock;
		const template = await templates.create({ name: "Brief", canvas: canvasWith(field), inputs: [LOGO] }, db);
		const data = `data:image/png;base64,${Buffer.from(PIXEL).toString("base64")}`;

		const filled = await templates.fillCanvas({ templateId: template.id, values: { logo: data } }, db);
		expect(filled.missing).toEqual([]);
		expect(filled.html).toContain(`src="${data}"`);

		const address = await templates.fillCanvas({ templateId: template.id, values: { logo: "https://example.com/a.png" } }, db);
		expect(address.missing).toEqual(["document.logo"]);
		expect(address.html).not.toContain("example.com");
		expect(address.html).toContain('src="data:image/svg+xml;base64,');
	});
});

describe("a template's pictures", () => {
	it("stores a picture once, and writes it into the document inline", async () => {
		const db = freshDb();
		const template = await templates.create({ name: "Brief" }, db);
		const first = await assets.add({ templateId: template.id, fileName: "logo.png", data: PIXEL }, db);
		const again = await assets.add({ templateId: template.id, fileName: "copy.png", data: PIXEL }, db);
		expect(again.id).toBe(first.id);
		expect(first.token).toBe(`{{asset.${assetKey(first.id)}}}`);
		expect(first.mimeType).toBe("image/png");

		await templates.update(template.id, { canvas: canvasWith(image(first.token)) }, db);
		const filled = await templates.fillCanvas({ templateId: template.id, values: {} }, db);
		expect(filled.missing).toEqual([]);
		expect(filled.html).toContain('src="data:image/png;base64,');
	});

	it("refuses what is not a picture, whatever it is called", async () => {
		const db = freshDb();
		const template = await templates.create({ name: "Brief" }, db);
		await expect(
			assets.add({ templateId: template.id, fileName: "logo.png", data: new TextEncoder().encode("<svg></svg>") }, db),
		).rejects.toThrow(/not a PNG, JPEG, GIF or WebP/);
	});

	it("marks a picture whose file has gone, instead of breaking the page", async () => {
		const db = freshDb();
		const template = await templates.create({ name: "Brief", canvas: canvasWith(image("{{asset.deadbeef}}")) }, db);
		const filled = await templates.fillCanvas({ templateId: template.id, values: {} }, db);
		expect(filled.missing).toEqual(["asset.deadbeef"]);
		expect(filled.html).toContain('src="data:image/svg+xml;base64,');
	});
});

/** A .docx is a zip; this writes one with its entries stored, which is all Word needs to read it back. */
function zip(entries: Record<string, string>): Uint8Array {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(entries)) {
		const data = Buffer.from(content, "utf8");
		const file = Buffer.from(name, "utf8");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(file.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(file.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, file, data);
		centrals.push(central, file);
		offset += local.length + file.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

function docx(paragraphs: string[]): Uint8Array {
	const body = paragraphs.map((words) => `<w:p><w:r><w:t xml:space="preserve">${words}</w:t></w:r></w:p>`).join("");
	return zip({
		"[Content_Types].xml":
			'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
		"_rels/.rels":
			'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
			'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
		"word/document.xml":
			'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
			`<w:body>${body}</w:body></w:document>`,
	});
}

describe("a Word file", () => {
	it("becomes a canvas template on A4 that asks for its fields", async () => {
		const db = freshDb();
		const template = await importDocx(
			{ fileName: "Offerte.docx", data: docx(["Beste {{ klant }},", "Het bedrag is {{bedrag}}."]) },
			db,
		);
		expect(template.name).toBe("Offerte");
		expect(template.canvas?.paper).toEqual({ size: "A4", orientation: "portrait" });
		expect(template.inputs.map((input) => input.key)).toEqual(["klant", "bedrag"]);
		const filled = await templates.fillCanvas({ templateId: template.id, values: { klant: "Jan", bedrag: "100 euro" } }, db);
		expect(filled.missing).toEqual([]);
		expect(filled.html).toContain("Beste Jan,");
		expect(filled.html).toContain("Het bedrag is 100 euro.");
	});

	it("turns a field into the key of an input", () => {
		expect(fieldKey("Naam klant")).toBe("naam_klant");
		expect(fieldKey("document.bedrag")).toBe("bedrag");
		expect(fieldKey("2de partij")).toBe("veld_2de_partij");
		expect(fieldKey("  ")).toBeNull();
	});

	it("reads headings, paragraphs, lists and tables into blocks, and its fields into inputs", () => {
		const { canvas, inputs } = canvasFromHtml(
			"<h1>Overeenkomst</h1><p>Tussen <strong>{{ Naam klant }}</strong> &amp; ons.</p>" +
				"<ul><li>Een</li><li>Twee<ul><li>Twee a</li></ul></li></ul>" +
				"<table><tr><th><p>Wat</p></th><th><p>Prijs</p></th></tr><tr><td><p>Site</p></td><td><p>{{bedrag}}</p></td></tr></table>",
		);
		const page = canvas.layout.children[0] as MailContainer;
		expect(page.children.map((node) => node.kind)).toEqual(["heading", "text", "text", "columns"]);
		const paragraph = page.children[1] as Extract<MailBlock, { kind: "text" }>;
		expect(paragraph.html).toBe("Tussen <strong>{{document.naam_klant}}</strong> &amp; ons.");
		const list = page.children[2] as Extract<MailBlock, { kind: "text" }>;
		expect(list.tag).toBe("ul");
		expect(list.html).toBe("<li>Een</li><li>Twee</li><li>Twee a</li>");
		const table = page.children[3];
		expect(table?.kind === "columns" ? table.rows.map((row) => row.cells.length) : []).toEqual([2, 2]);
		expect(inputs.map((input) => [input.key, input.label, input.required])).toEqual([
			["naam_klant", "Naam klant", true],
			["bedrag", "bedrag", true],
		]);
	});

	it("refuses a file that is not a .docx and leaves no template behind", async () => {
		const db = freshDb();
		await expect(
			importDocx({ fileName: "oud.doc", data: new TextEncoder().encode("not a zip") }, db),
		).rejects.toThrow(/not a Word document/);
		await expect(
			importDocx({ fileName: "kapot.docx", data: Uint8Array.from([0x50, 0x4b, 1, 2, 3]) }, db),
		).rejects.toThrow(/could not be read as a Word document/);
		expect(await templates.list(db)).toEqual([]);
	});
});
