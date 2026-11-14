import { describe, expect, it } from "vitest";
import { dragFileName, dragFileNames } from "./drag-name";

describe("the name of a file dragged out of Juno", () => {
	it("is the title with the newest version's extension", () => {
		expect(dragFileName("Offerte Acme", "offerte-acme-2026-11-14T09-00-00-000Z.PDF")).toBe("Offerte Acme.pdf");
		expect(dragFileName("Plan.docx", "plan-1.docx")).toBe("Plan.docx");
	});

	it("leaves out what Windows refuses in a name", () => {
		expect(dragFileName('Offerte: "nieuw"/v2?', "a.pdf")).toBe("Offerte nieuw v2.pdf");
		expect(dragFileName("Brief\tklaar. ", "a.txt")).toBe("Brief klaar.txt");
		expect(dragFileName("   ", null)).toBe("Document");
	});

	it("numbers two documents with the same title in one drag", () => {
		expect(
			dragFileNames([
				{ title: "Offerte", storedName: "a.pdf" },
				{ title: "Offerte", storedName: "b.pdf" },
				{ title: "Offerte", storedName: "c.docx" },
			]),
		).toEqual(["Offerte.pdf", "Offerte (2).pdf", "Offerte.docx"]);
	});
});
