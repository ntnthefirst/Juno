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

/* ------------------------------------------- iWork object files, written here */

function varintBytes(value: number): number[] {
	const out: number[] = [];
	let rest = value;
	while (rest >= 0x80) {
		out.push((rest % 0x80) | 0x80);
		rest = Math.floor(rest / 0x80);
	}
	out.push(rest);
	return out;
}

/** A protobuf field: a number, or bytes with their length. */
function protoField(number: number, value: number | Uint8Array | string): number[] {
	if (typeof value === "number") return [...varintBytes(number * 8), ...varintBytes(value)];
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
	return [...varintBytes(number * 8 + 2), ...varintBytes(bytes.length), ...bytes];
}

/** Raw Snappy written as literals only, which every decoder reads. */
export function snappyLiterals(data: Uint8Array): Uint8Array {
	const out: number[] = [...varintBytes(data.length)];
	for (let at = 0; at < data.length; at += 0x10000) {
		const part = data.subarray(at, Math.min(data.length, at + 0x10000));
		const size = part.length - 1;
		// Tag 61: the length minus one follows in two bytes.
		out.push(61 << 2, size & 0xff, size >> 8, ...part);
	}
	return new Uint8Array(out);
}

/** One object of an iWork file: a run of text of a kind (body 0, header 1, text box 3, note 4, cell 5), or a table's strings. */
export type IwaObject = { id: number; text?: { kind: number; text: string }; strings?: string[] };

/** An `.iwa` file holding these objects, in one Snappy chunk. */
export function iwaBytes(objects: IwaObject[]): Uint8Array {
	const body: number[] = [];
	for (const object of objects) {
		const payload = object.text
			? new Uint8Array([...protoField(1, object.text.kind), ...protoField(3, object.text.text)])
			: new Uint8Array([
					...protoField(1, 1),
					...(object.strings ?? []).flatMap((value, key) =>
						protoField(3, new Uint8Array([...protoField(1, key + 1), ...protoField(3, value)])),
					),
				]);
		const type = object.text ? 2001 : 6005;
		const info = new Uint8Array([
			...protoField(1, object.id),
			...protoField(2, new Uint8Array([...protoField(1, type), ...protoField(3, payload.length)])),
		]);
		body.push(...varintBytes(info.length), ...info, ...payload);
	}
	const compressed = snappyLiterals(new Uint8Array(body));
	const length = compressed.length;
	return new Uint8Array([0, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, ...compressed]);
}

/** A modern iWork file: its object files under `Index/`, and its own picture when given. */
export async function iworkTextBytes(files: Record<string, IwaObject[]>, picture?: Uint8Array): Promise<Uint8Array> {
	const zip = new JSZip();
	for (const [name, objects] of Object.entries(files)) zip.file(`Index/${name}`, iwaBytes(objects));
	if (picture) zip.file("preview.jpg", picture);
	return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Thirty-odd words, enough for a text match to mean something (pdf-text.ts). */
export const AGREEMENT = [
	"Overeenkomst voor het ontwikkelen van een website tussen de opdrachtgever en de opdrachtnemer.",
	"De opdrachtnemer levert de website op binnen de afgesproken termijn en bezorgt alle bestanden.",
	"Betaling gebeurt binnen dertig dagen na ontvangst van de factuur op het vermelde rekeningnummer.",
];

/**
 * The same ZIP with every entry claiming to unpack to two gigabytes, as a
 * ZIP bomb's directory does. Nothing is inflated, so this is cheap to make.
 */
export function bomb(zip: Uint8Array): Uint8Array {
	const out = new Uint8Array(zip);
	const view = new DataView(out.buffer);
	let end = out.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	for (let index = 0; index < count; index += 1) {
		view.setUint32(at + 24, 0x7fffffff, true);
		at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
	}
	return out;
}
