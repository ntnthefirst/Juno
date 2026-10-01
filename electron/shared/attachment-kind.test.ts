import { describe, expect, it } from "vitest";
import { attachmentKind, isOpenableAttachment } from "./attachment-kind";

describe("attachmentKind", () => {
	it("goes by the extension first, then the declared type", () => {
		expect(attachmentKind("Contract.PDF", "application/octet-stream")).toBe("pdf");
		expect(attachmentKind("scan", "image/png")).toBe("image");
		expect(attachmentKind("budget.xlsx", "")).toBe("sheet");
		expect(attachmentKind("mystery.bin", "application/octet-stream")).toBe("other");
	});
});

describe("isOpenableAttachment", () => {
	it("allows plain documents, images and media", () => {
		for (const name of ["a.pdf", "b.PNG", "c.docx", "d.csv", "e.mp4"]) {
			expect(isOpenableAttachment(name)).toBe(true);
		}
	});

	it("refuses anything executable, scripted or macro-capable", () => {
		for (const name of ["a.exe", "b.bat", "c.svg", "d.html", "e.docm", "f.xls", "g.lnk", "h.pdf.exe", "noextension"]) {
			expect(isOpenableAttachment(name)).toBe(false);
		}
	});
});
