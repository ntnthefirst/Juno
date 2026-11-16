/**
 * The words in an Apple iWork file (decision 83), read without Apple's
 * software: Windows has no renderer for Pages, Numbers or Keynote, and the
 * picture a file carries of itself shows only its first page.
 *
 * A modern iWork file is a zip whose `Index/*.iwa` files hold the document as
 * Protocol Buffers messages, cut into chunks compressed with Snappy. Each
 * chunk is a byte saying so (0), its length in three bytes, and a raw Snappy
 * block. Uncompressed, the chunks are a run of objects: an `ArchiveInfo`
 * message saying the object's id and the type and length of each message,
 * then those messages. Text lives in `TSWP.StorageArchive` messages (type
 * 2001): what kind of text it is in field 1 (the body, a header, a footnote,
 * a text box, a presenter's note, a table cell) and the characters in field
 * 3. A table's plain cells are strings in a `TST.TableDataList` (type 6005)
 * whose list type is 1, each entry's string in its field 3.
 *
 * Only that much is read, by a small Snappy decoder and a protobuf reader
 * that knows no schema, so nothing native is needed. Every length is checked
 * against what is left, the inflated size has a ceiling, and a file that does
 * not read as this format throws, so the caller shows the cover picture as
 * before.
 *
 * Which order things are drawn in lives in messages that differ between the
 * three apps and their versions, so it is not read. Pages keeps its running
 * text in one storage, in order; everything else is given in the order the
 * file keeps it, which is the order it was made in.
 *
 * Pure: no Electron, no file system. It runs in the file worker.
 */

import type { IworkApp, IworkSection } from "../../shared/types";

export type { IworkApp, IworkSection } from "../../shared/types";

export interface IworkText {
	sections: IworkSection[];
	/** True when the words went past the limit and the rest was left out. */
	truncated: boolean;
}

/** An `Index/*.iwa` entry of the zip, inflated. */
export interface IwaFile {
	name: string;
	bytes: Uint8Array;
}

/** The most a file's objects may unpack to, all chunks together. */
export const MAX_IWA_BYTES = 128 * 1024 * 1024;

const STORAGE = 2001;
const DATA_LIST = 6005;
const STRING_LIST = 1;

/** TSWP.StorageArchive's kinds. */
const KIND = { body: 0, header: 1, footnote: 2, textbox: 3, note: 4, cell: 5, unclassified: 6, tableCell: 7 } as const;

export class IworkFormatError extends Error {
	override name = "IworkFormatError";
}

/* --------------------------------------------------------------- Snappy */

/**
 * One raw Snappy block. Throws on anything that would read or write outside
 * the block or past `budget` bytes.
 */
export function unsnappy(source: Uint8Array, budget = MAX_IWA_BYTES): Uint8Array {
	let at = 0;
	let length = 0;
	let shift = 0;
	for (;;) {
		if (at >= source.length || shift > 28) throw new IworkFormatError("A Snappy block has no length.");
		const byte = source[at++]!;
		length += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) break;
		shift += 7;
	}
	if (length > budget) throw new IworkFormatError("This file unpacks to more than Juno reads.");
	const out = new Uint8Array(length);
	let written = 0;
	while (at < source.length) {
		const tag = source[at++]!;
		const type = tag & 3;
		if (type === 0) {
			let size = tag >> 2;
			if (size >= 60) {
				const bytes = size - 59;
				if (at + bytes > source.length) throw new IworkFormatError("A Snappy literal runs past its block.");
				size = 0;
				for (let index = 0; index < bytes; index += 1) size += source[at + index]! * 2 ** (8 * index);
				at += bytes;
			}
			size += 1;
			if (at + size > source.length || written + size > length) throw new IworkFormatError("A Snappy literal runs past its block.");
			out.set(source.subarray(at, at + size), written);
			at += size;
			written += size;
			continue;
		}
		let size: number;
		let offset: number;
		if (type === 1) {
			if (at + 1 > source.length) throw new IworkFormatError("A Snappy copy runs past its block.");
			size = ((tag >> 2) & 7) + 4;
			offset = ((tag >> 5) << 8) | source[at]!;
			at += 1;
		} else if (type === 2) {
			if (at + 2 > source.length) throw new IworkFormatError("A Snappy copy runs past its block.");
			size = (tag >> 2) + 1;
			offset = source[at]! | (source[at + 1]! << 8);
			at += 2;
		} else {
			if (at + 4 > source.length) throw new IworkFormatError("A Snappy copy runs past its block.");
			size = (tag >> 2) + 1;
			offset = (source[at]! | (source[at + 1]! << 8) | (source[at + 2]! << 16)) + source[at + 3]! * 2 ** 24;
			at += 4;
		}
		if (offset === 0 || offset > written || written + size > length) throw new IworkFormatError("A Snappy copy points outside its block.");
		// Byte by byte: a copy may overlap what it is writing, which is how a run repeats.
		for (let index = 0; index < size; index += 1) {
			out[written] = out[written - offset]!;
			written += 1;
		}
	}
	if (written !== length) throw new IworkFormatError("A Snappy block is shorter than it says.");
	return out;
}

/** An `.iwa` file's chunks, unpacked and joined. */
export function unpackIwa(file: Uint8Array, budget = MAX_IWA_BYTES): Uint8Array {
	const parts: Uint8Array[] = [];
	let total = 0;
	let at = 0;
	while (at < file.length) {
		if (at + 4 > file.length || file[at] !== 0) throw new IworkFormatError("This is not an iWork object file.");
		const size = file[at + 1]! | (file[at + 2]! << 8) | (file[at + 3]! << 16);
		if (at + 4 + size > file.length) throw new IworkFormatError("An iWork chunk runs past its file.");
		const part = unsnappy(file.subarray(at + 4, at + 4 + size), budget - total);
		parts.push(part);
		total += part.length;
		at += 4 + size;
	}
	const joined = new Uint8Array(total);
	let written = 0;
	for (const part of parts) {
		joined.set(part, written);
		written += part.length;
	}
	return joined;
}

/* ------------------------------------------------------------- protobuf */

type Field = { number: number; value: number | Uint8Array };

function varint(bytes: Uint8Array, cursor: { at: number }): number {
	let value = 0;
	let scale = 1;
	for (let index = 0; index < 10; index += 1) {
		if (cursor.at >= bytes.length) throw new IworkFormatError("A number runs past its message.");
		const byte = bytes[cursor.at++]!;
		value += (byte & 0x7f) * scale;
		if ((byte & 0x80) === 0) return value;
		scale *= 128;
	}
	throw new IworkFormatError("A number in this file is too long.");
}

/** The fields of one message, in order, without a schema: numbers and the bytes of anything with a length. */
export function readFields(bytes: Uint8Array): Field[] {
	const fields: Field[] = [];
	const cursor = { at: 0 };
	while (cursor.at < bytes.length) {
		const key = varint(bytes, cursor);
		const number = Math.floor(key / 8);
		const wire = key % 8;
		if (wire === 0) fields.push({ number, value: varint(bytes, cursor) });
		else if (wire === 2) {
			const size = varint(bytes, cursor);
			if (cursor.at + size > bytes.length) throw new IworkFormatError("A field runs past its message.");
			fields.push({ number, value: bytes.subarray(cursor.at, cursor.at + size) });
			cursor.at += size;
		} else if (wire === 1) cursor.at += 8;
		else if (wire === 5) cursor.at += 4;
		else throw new IworkFormatError("This file holds a field Juno cannot step over.");
		if (cursor.at > bytes.length) throw new IworkFormatError("A field runs past its message.");
	}
	return fields;
}

function numberOf(fields: Field[], number: number): number | null {
	const found = fields.find((field) => field.number === number && typeof field.value === "number");
	return found ? (found.value as number) : null;
}

function bytesOf(fields: Field[], number: number): Uint8Array[] {
	return fields.filter((field) => field.number === number && typeof field.value !== "number").map((field) => field.value as Uint8Array);
}

/** One message of one object: the object's id, the message's type and its bytes. */
export interface IwaMessage {
	id: number;
	type: number;
	payload: Uint8Array;
}

/** Every message in an unpacked `.iwa`, in the order the file keeps them. */
export function messagesOf(data: Uint8Array): IwaMessage[] {
	const messages: IwaMessage[] = [];
	const cursor = { at: 0 };
	while (cursor.at < data.length) {
		const size = varint(data, cursor);
		if (cursor.at + size > data.length) throw new IworkFormatError("An object's header runs past its file.");
		const info = readFields(data.subarray(cursor.at, cursor.at + size));
		cursor.at += size;
		const id = numberOf(info, 1) ?? 0;
		for (const message of bytesOf(info, 2)) {
			const described = readFields(message);
			const type = numberOf(described, 1) ?? 0;
			const length = numberOf(described, 3) ?? 0;
			if (cursor.at + length > data.length) throw new IworkFormatError("An object runs past its file.");
			messages.push({ id, type, payload: data.subarray(cursor.at, cursor.at + length) });
			cursor.at += length;
		}
	}
	return messages;
}

/* ------------------------------------------------------------------ text */

const decoder = new TextDecoder("utf-8");

/**
 * Text as iWork keeps it, as a person reads it: the object marks where a
 * table or a picture sits go, line and paragraph separators become line
 * breaks, and other control characters (page and column breaks) a line break
 * too.
 */
export function cleanText(text: string): string {
	let plain = "";
	for (const character of text) {
		const code = character.codePointAt(0)!;
		if (code === 0xfffc) continue;
		plain += code === 0x2028 || code === 0x2029 || (code < 32 && code !== 9 && code !== 10) ? "\n" : character;
	}
	return plain
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

interface Found {
	file: string;
	id: number;
	kind: number | "string";
	text: string;
}

/** The order an `.iwa` is read in: Document first, then by the number in its name, which is when it was made. */
function fileOrder(name: string): [number, number, string] {
	const base = name.split("/").pop() ?? name;
	const number = Number(/(\d+)/.exec(base)?.[1] ?? Number.NaN);
	return [base === "Document.iwa" ? 0 : 1, Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER, name];
}

function compareFiles(a: string, b: string): number {
	const [ga, na, sa] = fileOrder(a);
	const [gb, nb, sb] = fileOrder(b);
	return ga - gb || na - nb || sa.localeCompare(sb);
}

function textIn(file: IwaFile, budget: { left: number }): Found[] {
	const data = unpackIwa(file.bytes, budget.left);
	budget.left -= data.length;
	const found: Found[] = [];
	for (const message of messagesOf(data)) {
		if (message.type === STORAGE) {
			const fields = readFields(message.payload);
			const kind = numberOf(fields, 1) ?? KIND.textbox;
			const text = cleanText(bytesOf(fields, 3).map((part) => decoder.decode(part)).join(""));
			if (text) found.push({ file: file.name, id: message.id, kind, text });
		} else if (message.type === DATA_LIST) {
			const fields = readFields(message.payload);
			if (numberOf(fields, 1) !== STRING_LIST) continue;
			for (const entry of bytesOf(fields, 3)) {
				const text = cleanText(bytesOf(readFields(entry), 3).map((part) => decoder.decode(part)).join(""));
				if (text) found.push({ file: file.name, id: message.id, kind: "string", text });
			}
		}
	}
	return found;
}

/** Parts of a deck that are not its slides: its masters, its themes and the app's own state. */
const NOT_A_SLIDE = /(master|template|theme|stylesheet|metadata|viewstate|calculationengine|annotation|document\.iwa$)/i;

/**
 * The words in an iWork file, from its `Index/*.iwa` entries, cut at `limit`
 * characters. Throws `IworkFormatError` for a file that is not this format.
 */
export function readIworkText(files: IwaFile[], app: IworkApp, limit = 200_000): IworkText {
	const budget = { left: MAX_IWA_BYTES };
	const sorted = [...files].sort((a, b) => compareFiles(a.name, b.name));
	const found = sorted.flatMap((file) => textIn(file, budget));

	const join = (parts: Found[]) => parts.map((part) => part.text).join("\n\n");
	const isCell = (part: Found) => part.kind === "string" || part.kind === KIND.cell || part.kind === KIND.tableCell;
	const isBox = (part: Found) => part.kind === KIND.textbox || part.kind === KIND.footnote || part.kind === KIND.unclassified;

	let sections: IworkSection[];
	if (app === "pages") {
		sections = [
			{ role: "body", text: join(found.filter((part) => part.kind === KIND.body)) },
			{ role: "tables", text: join(found.filter(isCell)) },
			{ role: "boxes", text: join(found.filter(isBox)) },
		];
	} else if (app === "keynote") {
		const slideFiles = sorted.filter((file) => /\/Slide[^/]*\.iwa$/i.test(file.name)).map((file) => file.name);
		const onSlides = (part: Found) =>
			slideFiles.length > 0 ? slideFiles.includes(part.file) : !NOT_A_SLIDE.test(part.file);
		sections = [
			{
				role: "slides",
				text: join(found.filter((part) => onSlides(part) && part.kind !== KIND.note && part.kind !== KIND.header)),
			},
			{ role: "notes", text: join(found.filter((part) => part.kind === KIND.note)) },
		];
	} else {
		sections = [
			{ role: "tables", text: join(found.filter(isCell)) },
			{ role: "boxes", text: join(found.filter((part) => isBox(part) || part.kind === KIND.body)) },
		];
	}

	let left = limit;
	let truncated = false;
	const kept: IworkSection[] = [];
	for (const section of sections) {
		if (!section.text) continue;
		if (left <= 0) {
			truncated = true;
			break;
		}
		if (section.text.length > left) {
			kept.push({ role: section.role, text: section.text.slice(0, left) });
			truncated = true;
			left = 0;
		} else {
			kept.push(section);
			left -= section.text.length;
		}
	}
	return { sections: kept, truncated };
}

/** Which app made a file, by its extension, or null for one that is not iWork. */
export function iworkAppOf(fileName: string): IworkApp | null {
	const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase();
	if (extension === "pages") return "pages";
	if (extension === "numbers") return "numbers";
	if (extension === "key") return "keynote";
	return null;
}
