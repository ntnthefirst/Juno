import { describe, expect, it } from "vitest";
import { fileTypeIconKey } from "./file-type-icon";

describe("fileTypeIconKey", () => {
	it("goes by the extension first", () => {
		expect(fileTypeIconKey("Contract.docx", "application/octet-stream")).toBe("docx");
		expect(fileTypeIconKey("budget.xlsx", "")).toBe("xlsx");
		expect(fileTypeIconKey("deck.key", "")).toBe("key");
	});

	it("ignores the case of the extension", () => {
		expect(fileTypeIconKey("SCAN.PDF", "")).toBe("pdf");
		expect(fileTypeIconKey("Photo.JPG", "")).toBe("jpg");
	});

	it("sends a type without its own icon to its family", () => {
		expect(fileTypeIconKey("sheet.numbers", "")).toBe("ods");
		expect(fileTypeIconKey("backup.tar", "")).toBe("zip");
		expect(fileTypeIconKey("scan.tiff", "")).toBe("image");
		expect(fileTypeIconKey("mail.eml", "message/rfc822")).toBe("blank");
	});

	it("falls back to the media type when the name says nothing", () => {
		expect(fileTypeIconKey("download", "application/pdf")).toBe("pdf");
		expect(fileTypeIconKey("picture", "image/avif")).toBe("image");
		expect(fileTypeIconKey("logo", "image/svg+xml")).toBe("svg");
		expect(fileTypeIconKey("clip", "video/x-unknown")).toBe("mp4");
		expect(fileTypeIconKey("notes", "text/plain")).toBe("txt");
	});

	it("takes the blank page for anything else", () => {
		expect(fileTypeIconKey("mystery.bin", "application/octet-stream")).toBe("blank");
		expect(fileTypeIconKey(null, "")).toBe("blank");
		expect(fileTypeIconKey(".hidden", "")).toBe("blank");
	});
});
