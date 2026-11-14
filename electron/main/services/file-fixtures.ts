/**
 * Small files of each kind, made in memory for tests. Never imported by
 * application code, and never a real client's file.
 */
import { resolve } from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

export function freshDb(): Db {
	return freshConnection().db;
}

/** The database and its connection, for a test that writes rows no service makes (a fetched mail). */
export function freshConnection() {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return { db: createDrizzle(connection), connection };
}

/** One white pixel. */
export const PNG_BYTES = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	),
);

/** The smallest JPEG header a reader recognises. Only ever copied, never decoded. */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

export async function textPdf(lines: string[]): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage();
	lines.forEach((line, index) => page.drawText(line, { x: 40, y: 780 - index * 14, size: 9, font }));
	return doc.save();
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A Word file with one paragraph per line: the three parts a package needs and nothing else. */
export async function docxBytes(paragraphs: string[]): Promise<Uint8Array> {
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
			"</Types>",
	);
	zip.file(
		"_rels/.rels",
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
			'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
			"</Relationships>",
	);
	zip.file(
		"word/document.xml",
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
			paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join("") +
			"</w:body></w:document>",
	);
	return zip.generateAsync({ type: "uint8array" });
}

/** A workbook with one sheet per entry, written by ExcelJS itself. */
export async function xlsxBytes(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
	const module = await import("exceljs");
	const lib = (module as typeof module & { default?: typeof module }).default ?? module;
	const workbook = new lib.Workbook();
	for (const [name, rows] of Object.entries(sheets)) workbook.addWorksheet(name).addRows(rows);
	return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** An iWork file as it arrives on Windows: a zip carrying its own preview picture. */
export async function iworkBytes(picture: Uint8Array, at = "preview.jpg"): Promise<Uint8Array> {
	const zip = new JSZip();
	zip.file("Index/Document.iwa", new Uint8Array([1, 2, 3]));
	zip.file(at, picture);
	return zip.generateAsync({ type: "uint8array" });
}

/** Thirty-odd words, enough for a text match to mean something (pdf-text.ts). */
export const AGREEMENT = [
	"Overeenkomst voor het ontwikkelen van een website tussen de opdrachtgever en de opdrachtnemer.",
	"De opdrachtnemer levert de website op binnen de afgesproken termijn en bezorgt alle bestanden.",
	"Betaling gebeurt binnen dertig dagen na ontvangst van de factuur op het vermelde rekeningnummer.",
];
