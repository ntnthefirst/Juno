import { describe, expect, it } from "vitest";
import { attachedNameOf } from "./file-type";

describe("the name a document is attached under", () => {
	it("keeps the extension of its newest file, and is a PDF before it has one", () => {
		expect(attachedNameOf({ title: "Offerte", latestVersion: { fileName: "offerte-v3.docx" } })).toBe("Offerte.docx");
		expect(attachedNameOf({ title: "Offerte", latestVersion: { fileName: "Offerte.pdf" } })).toBe("Offerte.pdf");
		expect(attachedNameOf({ title: "Contract", latestVersion: null })).toBe("Contract.pdf");
	});
});
