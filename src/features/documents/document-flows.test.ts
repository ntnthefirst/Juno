import { describe, expect, it } from "vitest";
import { convertedSentence, needsConversion } from "./document-flows";

const withLatest = (fileName: string, mediaType = "") => ({ latestVersion: { fileName, mediaType } });

describe("document flows", () => {
	it("converts before signing only when the newest version is not a PDF", () => {
		expect(needsConversion(withLatest("Offerte.pdf", "application/pdf"))).toBe(false);
		expect(needsConversion(withLatest("Offerte.docx"))).toBe(true);
		expect(needsConversion({ latestVersion: null })).toBe(true);
	});

	it("says when Juno converted because Word is not here", () => {
		expect(convertedSentence("word")).toBe("Converted to PDF through Word.");
		expect(convertedSentence("juno")).toMatch(/layout may differ/);
	});
});
