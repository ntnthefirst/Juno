import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fakeWorker, sourceWorker } from "../workers/file-worker-fixtures";
import { docxBytes, xlsxBytes } from "./file-fixtures";
import { configureFileReader, FileReadError, readInWorker } from "./file-reader";
import { PREVIEW_LIMITS } from "./file-text";

afterAll(() => configureFileReader({ source: sourceWorker() }));

describe("the file worker", () => {
	afterEach(() => configureFileReader({ source: sourceWorker() }));

	it("reads a Word file and a workbook off the main process", async () => {
		const html = await readInWorker({ kind: "word-html" }, await docxBytes(["Offerte voor de website", "Tweede alinea"]));
		expect(html).toContain("<p>Offerte voor de website</p>");
		const text = await readInWorker({ kind: "word-text" }, await docxBytes(["Alleen tekst"]));
		expect(text.trim()).toBe("Alleen tekst");
		const { sheets } = await readInWorker(
			{ kind: "workbook", limits: PREVIEW_LIMITS },
			await xlsxBytes({ Uren: [["Dag", "Uren"], ["maandag", 7]] }),
		);
		expect(sheets[0]!.rows).toEqual([["Dag", "Uren"], ["maandag", "7"]]);
	});

	it("leaves bytes it was not given to keep as they were, and moves the ones it was", async () => {
		const kept = await docxBytes(["Blijft"]);
		const length = kept.byteLength;
		await readInWorker({ kind: "word-text" }, kept);
		expect(kept.byteLength).toBe(length);

		const given = new Uint8Array(await docxBytes(["Gaat mee"]));
		await readInWorker({ kind: "word-text" }, given, { transfer: true });
		expect(given.byteLength).toBe(0);
	});

	it("answers jobs one after another in the order they were asked", async () => {
		const words = ["een", "twee", "drie", "vier"];
		const files = await Promise.all(words.map((word) => docxBytes([word])));
		const texts = await Promise.all(files.map((bytes) => readInWorker({ kind: "word-text" }, bytes)));
		expect(texts.map((text) => text.trim())).toEqual(words);
	});

	it("passes on what the parser threw for a file it cannot read, and keeps working", async () => {
		await expect(
			readInWorker({ kind: "workbook", limits: PREVIEW_LIMITS }, new Uint8Array(Buffer.from("geen werkboek"))),
		).rejects.toThrow(Error);
		expect((await readInWorker({ kind: "word-text" }, await docxBytes(["Nog altijd"]))).trim()).toBe("Nog altijd");
	});

	it("ends a job that runs past its time limit, says so, and starts a fresh worker for the next", async () => {
		// Never answers a PDF; answers anything else with the id of the thread it runs on.
		configureFileReader({
			source: fakeWorker(`if (job.kind === "pdf-text") return undefined; return String(threadId);`),
			timeLimitMs: 1000,
		});
		const first = await readInWorker({ kind: "word-text" }, new Uint8Array(4));
		const stuck = readInWorker({ kind: "pdf-text" }, new Uint8Array(4), { fileName: "Jaarverslag.pdf" });
		await expect(stuck).rejects.toBeInstanceOf(FileReadError);
		await expect(stuck).rejects.toThrow('Juno stopped reading "Jaarverslag.pdf" after 1 second. Open it in the app that made it.');
		const after = await readInWorker({ kind: "word-text" }, new Uint8Array(4));
		expect(after).not.toBe(first);
	});

	it("starts the time limit of a job when the worker is handed it, not while it waits", async () => {
		configureFileReader({
			source: fakeWorker(`return new Promise((resolve) => setTimeout(() => resolve("klaar"), 400));`),
			timeLimitMs: 1000,
		});
		const answers = await Promise.all([1, 2, 3].map(() => readInWorker({ kind: "word-text" }, new Uint8Array(1))));
		expect(answers).toEqual(["klaar", "klaar", "klaar"]);
	});

	it("turns an error inside a job into a rejection with its message", async () => {
		configureFileReader({ source: fakeWorker(`throw new Error("Kapot bestand");`) });
		await expect(readInWorker({ kind: "word-html" }, new Uint8Array(1))).rejects.toThrow("Kapot bestand");
	});

	it("says what happened when the worker itself dies, and recovers for the next job", async () => {
		configureFileReader({
			source: fakeWorker(`if (job.kind === "pdf-text") setTimeout(() => { throw new Error("weg"); }); else return "ok"; return undefined;`),
		});
		const lost = readInWorker({ kind: "pdf-text" }, new Uint8Array(1), { fileName: "Scan.pdf" });
		await expect(lost).rejects.toBeInstanceOf(FileReadError);
		await expect(lost).rejects.toThrow('Juno could not finish reading "Scan.pdf". Try again, or open it in the app that made it.');
		expect(await readInWorker({ kind: "word-text" }, new Uint8Array(1))).toBe("ok");
	});
});
