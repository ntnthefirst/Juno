import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { compareText, extractText } from "./pdf-text";

const CLAUSE =
	"De opdrachtnemer levert de website op binnen de afgesproken termijn en bezorgt de opdrachtgever alle bestanden. " +
	"Betaling gebeurt binnen dertig dagen na ontvangst van de factuur op het rekeningnummer vermeld op de factuur.";

async function pdfWith(lines: string[]): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage();
	lines.forEach((line, index) => page.drawText(line, { x: 40, y: 780 - index * 14, size: 9, font }));
	return doc.save();
}

describe("pdf text", () => {
	it("reads the text layer of a PDF", async () => {
		const text = await extractText(await pdfWith(["Overeenkomst voor hosting", "Artikel 1"]));
		expect(text).toBe("overeenkomst voor hosting artikel 1");
	});

	it("returns null for a file that is not a PDF", async () => {
		expect(await extractText(new Uint8Array(Buffer.from("hello")))).toBeNull();
	});

	it("takes a signed copy for the same document", () => {
		const signed = `${CLAUSE} Nathan Perron ondertekend op 30/09/2026 om 10:25 ondertekeningsgegevens document: contract sjabloon nda sha-256`;
		expect(compareText(CLAUSE, signed).same).toBe(true);
	});

	it("does not take a different text for the same document", () => {
		const other =
			"Deze offerte beschrijft het onderhoud van een bestaande webwinkel gedurende twaalf maanden, met maandelijkse updates en een rapport per kwartaal voor de klant.";
		expect(compareText(CLAUSE, other).same).toBe(false);
	});

	it("does not match a short letter to the contract it quotes", () => {
		expect(compareText(CLAUSE, `${CLAUSE} ${CLAUSE} ${CLAUSE}`).same).toBe(false);
	});
});
