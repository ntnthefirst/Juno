import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as clipboard from "./clipboard";
import * as clients from "./clients";
import { createFile, importFile } from "./document-import";
import * as documents from "./documents";
import { configureDocumentStorage } from "./documents";
import { freshConnection, PNG_BYTES } from "./file-fixtures";
import * as pages from "./pages";
import * as projects from "./projects";

const FILES = { clientId: null, projectId: null };
const AT = new Date(2026, 10, 16, 14, 5);

function text(fileName: string, words: string) {
	return { kind: "bytes" as const, fileName, data: new Uint8Array(Buffer.from(words)) };
}

async function setUp(start: Parameters<typeof clipboard.memoryClipboard>[0] = {}) {
	const { db } = freshConnection();
	configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-clipboard-docs-")));
	const system = clipboard.memoryClipboard(start);
	clipboard.configureClipboard(system, mkdtempSync(join(tmpdir(), "juno-clipboard-")));
	const acme = await clients.create({ name: "Acme" }, db);
	const website = await projects.create({ name: "Website", clientId: acme.id }, db);
	return { db, system, acme, website };
}

describe("copying documents", () => {
	it("puts a copy of each newest file on the system clipboard, named by its title", async () => {
		const { db, system, acme } = await setUp();
		const offer = await importFile({ source: text("offerte-v3.txt", "Prijs."), title: "Offerte", clientId: acme.id }, db);
		const page = await pages.create({ title: "Checklist", clientId: acme.id }, db);
		const result = await clipboard.copy([offer.id, page.document.id], "copy", db);
		expect(result).toEqual({ count: 2, mode: "copy", toSystem: true });
		// A page has no file to hand to another program, so only the file goes to the system clipboard.
		expect(system.state.files.map((path) => basename(path))).toEqual(["Offerte.txt"]);
		expect(readFileSync(system.state.files[0]!, "utf8")).toBe("Prijs.");
		expect(system.state.files[0]).not.toBe(offer.pdfPath);
	});

	it("refuses when nothing copied exists any more", async () => {
		const { db } = await setUp();
		await expect(clipboard.copy(["gone"], "copy", db)).rejects.toThrow(/nothing to copy/);
	});
});

describe("pasting", () => {
	it("pastes documents copied in Juno as copies: the same title in another place, '(copy)' in the same", async () => {
		const { db, acme, website } = await setUp();
		const terms = await importFile({ source: text("Voorwaarden.txt", "Onze voorwaarden.") }, db);
		await clipboard.copy([terms.id], "copy", db);

		const elsewhere = await clipboard.paste({ clientId: acme.id, projectId: null }, db);
		expect(elsewhere).toMatchObject({ kind: "documents", mode: "copy", documents: [{ title: "Voorwaarden", clientId: acme.id }] });
		const same = await clipboard.paste(FILES, db);
		expect(same).toMatchObject({ kind: "documents", documents: [{ title: "Voorwaarden (copy)", clientId: null, projectId: null }] });
		// A copy pastes again until something else is copied.
		const project = await clipboard.paste({ clientId: null, projectId: website.id }, db);
		expect(project).toMatchObject({ kind: "documents", documents: [{ projectId: website.id, clientId: acme.id }] });
	});

	it("moves documents that were cut, once, and leaves one pasted where it already is", async () => {
		const { db, acme } = await setUp();
		const one = await importFile({ source: text("Een.txt", "1"), clientId: acme.id }, db);
		const two = await importFile({ source: text("Twee.txt", "2") }, db);
		await clipboard.copy([one.id, two.id], "cut", db);

		const pasted = await clipboard.paste(FILES, db);
		expect(pasted).toMatchObject({ kind: "documents", mode: "cut" });
		expect(pasted.kind === "documents" ? pasted.documents.map((record) => record.title) : []).toEqual(["Een"]);
		expect(await documents.get(one.id, db)).toMatchObject({ clientId: null, projectId: null });
		// The cut is used up; the clipboard still holds the files, which now paste as files.
		expect((await clipboard.paste(FILES, db)).kind).toBe("files");
	});

	it("pastes what was copied elsewhere after a copy in Juno, not the documents", async () => {
		const { db, system } = await setUp();
		const terms = await importFile({ source: text("Voorwaarden.txt", "Tekst.") }, db);
		await clipboard.copy([terms.id], "copy", db);
		system.state.files = [];
		system.state.text = "Copied in another app";
		const pasted = await clipboard.paste(FILES, db, AT);
		expect(pasted).toMatchObject({ kind: "files", source: "text" });
	});

	it("hands back files copied in Explorer, every one of them, with their bytes and names", async () => {
		const folder = mkdtempSync(join(tmpdir(), "juno-explorer-copy-"));
		const a = join(folder, "Prijslijst.csv");
		const b = join(folder, "Logo.png");
		writeFileSync(a, "hout;12");
		writeFileSync(b, PNG_BYTES);
		const { db } = await setUp({ files: [a, b], text: "ignored while there are files" });
		const pasted = await clipboard.paste(FILES, db, AT);
		expect(pasted.kind).toBe("files");
		if (pasted.kind !== "files") return;
		expect(pasted.source).toBe("files");
		expect(pasted.files.map((file) => [file.fileName, file.mediaType])).toEqual([
			["Prijslijst.csv", "text/csv"],
			["Logo.png", "image/png"],
		]);
		expect(Buffer.from(pasted.files[0]!.data).toString()).toBe("hout;12");
	});

	it("names a picture and text by the time they were pasted, and they import into Files", async () => {
		const picture = await setUp({ image: PNG_BYTES, text: "a picture's alt text loses to the picture" });
		const image = await clipboard.paste(FILES, picture.db, AT);
		expect(image).toMatchObject({ kind: "files", source: "image", files: [{ fileName: "Pasted image 2026-11-16 14.05.png", mediaType: "image/png" }] });

		const { db } = await setUp({ text: "Bel de leverancier terug." });
		const pasted = await clipboard.paste(FILES, db, AT);
		expect(pasted).toMatchObject({ kind: "files", source: "text", files: [{ fileName: "Pasted text 2026-11-16 14.05.txt", mediaType: "text/plain" }] });
		if (pasted.kind !== "files") return;
		const kept = await importFile({ source: { kind: "bytes", ...pasted.files[0]! }, ...FILES }, db);
		expect(kept).toMatchObject({ title: "Pasted text 2026-11-16 14.05", clientId: null, projectId: null });
		expect((await documents.listUnfiled(db)).map((record) => record.id)).toEqual([kept.id]);
	});

	it("finds nothing on an empty clipboard, and says whether there is anything to paste", async () => {
		const { db, system } = await setUp();
		expect(clipboard.canPaste()).toBe(false);
		expect(await clipboard.paste(FILES, db)).toEqual({ kind: "empty" });
		system.state.text = "   ";
		expect(await clipboard.paste(FILES, db)).toEqual({ kind: "empty" });
		system.state.text = "iets";
		expect(clipboard.canPaste()).toBe(true);
	});
});

describe("copying a picture from its preview", () => {
	it("puts the picture itself on the clipboard, by the id the preview was made from", async () => {
		const { db, system, acme } = await setUp({ text: "earlier" });
		const logo = await importFile({ source: { kind: "bytes", fileName: "Logo.png", data: PNG_BYTES }, clientId: acme.id }, db);
		await clipboard.copyPicture({ kind: "document", documentId: logo.id }, db);
		expect(system.state.image).toEqual(PNG_BYTES);
		expect(system.state.text).toBe("");
		await clipboard.copyPicture({ kind: "bytes", fileName: "Foto.png", data: PNG_BYTES }, db);
		expect(system.state.image).toEqual(PNG_BYTES);
	});

	it("refuses what is not a picture, an SVG included", async () => {
		const { db } = await setUp();
		await expect(clipboard.copyPicture(text("Logo.svg", "<svg/>"), db)).rejects.toThrow(/not a picture Juno can copy/);
		await expect(clipboard.copyPicture(text("Brief.txt", "Hallo"), db)).rejects.toThrow(/not a picture Juno can copy/);
	});
});

describe("keeping contents as a file, for an agent", () => {
	it("keeps text or base64 bytes, and refuses both or neither", async () => {
		const { db, acme } = await setUp();
		const note = await createFile({ fileName: "Afspraken.txt", text: "Dinsdag om tien.", clientId: acme.id }, db);
		expect(note).toMatchObject({ title: "Afspraken", clientId: acme.id, latestVersion: { mediaType: "text/plain" } });
		const logo = await createFile({ fileName: "Logo.png", dataBase64: Buffer.from(PNG_BYTES).toString("base64") }, db);
		expect(logo).toMatchObject({ title: "Logo", clientId: null, projectId: null, latestVersion: { mediaType: "image/png" } });
		await expect(createFile({ fileName: "Beide.txt", text: "a", dataBase64: "YQ==" }, db)).rejects.toThrow(/one of the two/);
		await expect(createFile({ fileName: "Geen.txt" }, db)).rejects.toThrow(/one of the two/);
	});
});
