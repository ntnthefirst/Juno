import { describe, expect, it } from "vitest";
import type { DocumentRecord } from "@shared/types";
import { documentItem, matchesSearch, nextSort, projectOf, sortItems, typeOf } from "./explorer-items";
import { fileTypeLabel, isPdfFile } from "../../lib/file-type";

function record(partial: Partial<DocumentRecord> & Pick<DocumentRecord, "id" | "title">): DocumentRecord {
	return {
		ownerId: "o",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		clientId: null,
		clientName: null,
		projectId: null,
		projectName: null,
		templateId: null,
		templateVersion: null,
		statusId: null,
		bodyHtml: "",
		issuedOn: null,
		pdfPath: null,
		isSpecimen: false,
		sourceKind: "imported",
		versionCount: 1,
		latestVersion: null,
		folderId: null,
		...partial,
	};
}

const file = (id: string, title: string, fileName: string, mediaType: string, byteSize: number, fileDate: string) =>
	record({ id, title, latestVersion: { id: `v${id}`, kind: "imported", fileDate, fileName, mediaType, byteSize } });

const offer = file("1", "Offerte 10", "offerte.pdf", "application/pdf", 3000, "2026-03-01T00:00:00.000Z");
const offer2 = file("2", "Offerte 9", "offerte-9.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000, "2026-05-01T00:00:00.000Z");
const sheet = file("3", "Budget", "budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 2000, "2026-04-01T00:00:00.000Z");
const ITEMS = [documentItem(offer), documentItem(offer2), documentItem(sheet)];

describe("sortItems", () => {
	it("sorts names the way a person counts", () => {
		const names = sortItems(ITEMS, { by: "name", descending: false }).map((item) => item.key);
		expect(names).toEqual(["doc:3", "doc:2", "doc:1"]);
	});

	it("sorts by size and by date, either way round", () => {
		expect(sortItems(ITEMS, { by: "size", descending: true }).map((item) => item.key)).toEqual(["doc:1", "doc:3", "doc:2"]);
		expect(sortItems(ITEMS, { by: "modified", descending: false }).map((item) => item.key)).toEqual(["doc:1", "doc:3", "doc:2"]);
	});

	it("turns the order round on the same column and starts dates newest first", () => {
		expect(nextSort({ by: "name", descending: false }, "name")).toEqual({ by: "name", descending: true });
		expect(nextSort({ by: "name", descending: false }, "modified")).toEqual({ by: "modified", descending: true });
		expect(nextSort({ by: "size", descending: true }, "type")).toEqual({ by: "type", descending: false });
	});
});

describe("typeOf and fileTypeLabel", () => {
	it("names a file's type in a word", () => {
		expect(typeOf(documentItem(offer))).toBe("PDF");
		expect(typeOf(documentItem(offer2))).toBe("Word");
		expect(typeOf(documentItem(sheet))).toBe("Excel");
		expect(typeOf(documentItem(record({ id: "p", title: "Notes", sourceKind: "page" })))).toBe("Page");
		expect(typeOf(documentItem(record({ id: "g", title: "Draft", sourceKind: "generated" })))).toBe("No file yet");
	});

	it("falls back to the declared type, then the extension", () => {
		expect(fileTypeLabel("scan", "application/pdf")).toBe("PDF");
		expect(fileTypeLabel("photo", "image/x-raw")).toBe("Image");
		expect(fileTypeLabel("model.step", "application/octet-stream")).toBe("STEP");
		expect(fileTypeLabel(null, "application/octet-stream")).toBe("File");
		expect(isPdfFile("contract.PDF", "application/octet-stream")).toBe(true);
	});
});

describe("projectOf", () => {
	it("names the project a client's document is kept under, and nothing for the client's own", () => {
		expect(projectOf(documentItem(record({ id: "a", title: "Plan", projectName: "Keuken" })))).toBe("Keuken");
		expect(projectOf(documentItem(record({ id: "b", title: "Offerte", clientName: "Jansen" })))).toBe("");
	});
});

describe("matchesSearch", () => {
	it("matches every word against the title, the client, the project and the file name", () => {
		const kept = record({ ...offer, clientName: "Jansen", projectName: "Keuken" });
		expect(matchesSearch(kept, "jansen offerte")).toBe(true);
		expect(matchesSearch(kept, "keuken")).toBe(true);
		expect(matchesSearch(kept, "offerte.pdf")).toBe(true);
		expect(matchesSearch(kept, "peeters")).toBe(false);
		expect(matchesSearch(kept, "  ")).toBe(true);
	});
});
