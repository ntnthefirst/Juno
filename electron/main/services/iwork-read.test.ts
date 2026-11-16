/**
 * Reading the words in an iWork file (decision 83), from object files built
 * here: Snappy chunks, protobuf objects, text storages and string tables, for
 * Pages, Keynote and Numbers, and the preview and the agent that read them.
 */
import { describe, expect, it } from "vitest";
import type { FilePreview } from "../../shared/types";
import { freshDb, iwaBytes, iworkBytes, iworkTextBytes, JPEG_BYTES } from "./file-fixtures";
import { preview, previewForAgent } from "./file-preview";
import { readableText, readIwork } from "./file-text";
import { cleanText, IworkFormatError, readIworkText, unpackIwa, unsnappy } from "./iwork-read";

const BODY = 0;
const HEADER = 1;
const TEXTBOX = 3;
const NOTE = 4;
const CELL = 5;

function bytes(fileName: string, data: Uint8Array) {
	return { kind: "bytes" as const, fileName, data };
}

describe("Snappy and the object files", () => {
	it("reads literals and copies, a copy that overlaps itself included", () => {
		// "abc", then a copy of nine bytes from three back: abcabcabcabc.
		const block = new Uint8Array([12, (3 - 1) << 2, 0x61, 0x62, 0x63, ((9 - 4) << 2) | 1, 3]);
		expect(new TextDecoder().decode(unsnappy(block))).toBe("abcabcabcabc");
	});

	it("refuses a copy from before the start, a block shorter than it says, and one past the budget", () => {
		expect(() => unsnappy(new Uint8Array([4, ((4 - 4) << 2) | 1, 1]))).toThrow(IworkFormatError);
		expect(() => unsnappy(new Uint8Array([5, (2 - 1) << 2, 0x61, 0x62]))).toThrow(IworkFormatError);
		expect(() => unsnappy(new Uint8Array([100, 0]), 50)).toThrow(/more than Juno reads/);
	});

	it("refuses a file that is not chunks of objects", () => {
		expect(() => unpackIwa(new Uint8Array([7, 1, 0, 0, 0]))).toThrow(IworkFormatError);
		expect(() => unpackIwa(new Uint8Array([0, 200, 0, 0, 1]))).toThrow(IworkFormatError);
	});

	it("turns object marks and separators into text a person reads", () => {
		expect(cleanText("Titel Tekst ￼\u000Bna de breuk regel")).toBe("Titel\nTekst\nna de breuk\nregel");
	});
});

describe("the words in an iWork file", () => {
	it("gives a Pages document its running text first, then its tables and its text boxes", () => {
		const read = readIworkText(
			[
				{
					name: "Index/Tables/DataList-12-2.iwa",
					bytes: iwaBytes([{ id: 30, strings: ["Eik", "38 mm"] }, { id: 31, text: { kind: CELL, text: "Antwoord: ja" } }]),
				},
				{
					name: "Index/Document.iwa",
					bytes: iwaBytes([
						{ id: 1, text: { kind: BODY, text: "Vragen over de inhoud\nEen tabel volgt: ￼" } },
						{ id: 2, text: { kind: HEADER, text: "Noir · pagina ￼" } },
						{ id: 3, text: { kind: TEXTBOX, text: "Een kader" } },
					]),
				},
			],
			"pages",
		);
		expect(read.truncated).toBe(false);
		expect(read.sections).toEqual([
			{ role: "body", text: "Vragen over de inhoud\nEen tabel volgt:" },
			{ role: "tables", text: "Eik\n\n38 mm\n\nAntwoord: ja" },
			{ role: "boxes", text: "Een kader" },
		]);
	});

	it("gives a deck the words on its slides and its notes, and not its masters", () => {
		const read = readIworkText(
			[
				{ name: "Index/MasterSlide-5.iwa", bytes: iwaBytes([{ id: 5, text: { kind: TEXTBOX, text: "Titel van de dia" } }]) },
				{ name: "Index/Slide-20.iwa", bytes: iwaBytes([{ id: 21, text: { kind: TEXTBOX, text: "Tweede dia" } }]) },
				{
					name: "Index/Slide-10.iwa",
					bytes: iwaBytes([
						{ id: 11, text: { kind: TEXTBOX, text: "Eerste dia" } },
						{ id: 12, text: { kind: NOTE, text: "Zeg dit eerst" } },
					]),
				},
			],
			"keynote",
		);
		expect(read.sections).toEqual([
			{ role: "slides", text: "Eerste dia\n\nTweede dia" },
			{ role: "notes", text: "Zeg dit eerst" },
		]);
	});

	it("gives a Numbers file the words in its tables, then its text boxes", () => {
		const read = readIworkText(
			[
				{ name: "Index/Document.iwa", bytes: iwaBytes([{ id: 1, text: { kind: TEXTBOX, text: "Prijzen hout" } }]) },
				{ name: "Index/Tables/DataList-3.iwa", bytes: iwaBytes([{ id: 9, strings: ["Soort", "Eik", "Beuk"] }]) },
			],
			"numbers",
		);
		expect(read.sections).toEqual([
			{ role: "tables", text: "Soort\n\nEik\n\nBeuk" },
			{ role: "boxes", text: "Prijzen hout" },
		]);
	});

	it("cuts at the limit and says so", () => {
		const read = readIworkText(
			[{ name: "Index/Document.iwa", bytes: iwaBytes([{ id: 1, text: { kind: BODY, text: "a".repeat(50) } }]) }],
			"pages",
			20,
		);
		expect(read).toEqual({ sections: [{ role: "body", text: "a".repeat(20) }], truncated: true });
	});
});

describe("an iWork file's preview", () => {
	it("shows its own picture and then its words, and gives an agent the same words", async () => {
		const file = await iworkTextBytes(
			{ "Document.iwa": [{ id: 1, text: { kind: BODY, text: "Offerte voor de keuken\nPrijs op aanvraag" } }] },
			JPEG_BYTES,
		);
		const shown = (await preview(bytes("Offerte.pages", file), freshDb())) as Extract<FilePreview, { kind: "iwork" }>;
		expect(shown).toMatchObject({ kind: "iwork", app: "pages", truncated: false });
		expect(shown.cover).toMatch(/^app:\/\/preview\/[a-f0-9]{48}$/);
		expect(shown.sections).toEqual([{ role: "body", text: "Offerte voor de keuken\nPrijs op aanvraag" }]);

		const agent = await previewForAgent(bytes("Offerte.pages", file), freshDb());
		expect(agent).toMatchObject({ kind: "iwork", text: "Offerte voor de keuken\nPrijs op aanvraag" });
		// The same words recognise it as a document already kept (decision 39).
		expect((await readableText(file, "Offerte.pages")).text).toContain("Prijs op aanvraag");
	});

	it("keeps the picture alone when the file's words cannot be read", async () => {
		const old = await iworkBytes(JPEG_BYTES);
		expect(await readIwork(old, "Oud.key")).toBeNull();
		expect(await preview(bytes("Oud.key", old), freshDb())).toMatchObject({ kind: "thumbnail", from: "iwork" });
	});

	it("shows the words without a picture when the file carries none", async () => {
		const file = await iworkTextBytes({ "Slide-1.iwa": [{ id: 2, text: { kind: TEXTBOX, text: "Welkom" } }] });
		expect(await preview(bytes("Deck.key", file), freshDb())).toMatchObject({
			kind: "iwork",
			app: "keynote",
			cover: null,
			sections: [{ role: "slides", text: "Welkom" }],
		});
	});
});
