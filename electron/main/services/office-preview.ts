/**
 * A Word file or a slide deck previewed as the PDF its own program makes of it
 * (decision 83), so its pages and slides scroll with their real layout.
 *
 * - **The program decides the route.** Word for what Word opens (`.docx`,
 *   `.docm`, `.doc`, `.rtf`, `.odt`), PowerPoint for a deck (`.pptx`, `.pptm`,
 *   `.ppt`, `.pps`, `.ppsx`, `.odp`), and nothing when that program is not
 *   installed. Nothing here is an error: the caller shows what it showed
 *   before, Word as HTML and a deck as the picture Windows draws.
 * - **The program reads a copy**, in a folder of its own under the system's
 *   temporary folder that is removed afterwards. The person's file is never
 *   opened in place, so nothing (a lock file, a recovered copy) can appear
 *   beside it, and a kept version is never touched.
 * - **Kept once made** (`preview-cache.ts`): the second look is a file read.
 * - **One conversion per file at a time.** Two windows asking for the same
 *   file wait for the same run, and a file that failed is not tried again
 *   until Juno restarts, so a deck PowerPoint cannot open does not cost a
 *   minute on every look.
 * - **Never on the main thread.** The program runs in its own process
 *   (`word-convert.ts`), and the copy, the hash and the read are asynchronous.
 *
 * The programs are handed in at startup (`configureOfficePreview`), so this
 * module is tested with conversions that are not real.
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionOf } from "../../shared/mime";
import { familyOf, isPdfBytes, safeExtensionOf } from "./file-kind";
import * as cache from "./preview-cache";

export type OfficeRoute = "word" | "powerpoint";

type Hooks = {
	wordAvailable: () => Promise<boolean>;
	powerpointAvailable: () => Promise<boolean>;
	convertWithWord: (inputPath: string, outputPath: string) => Promise<void>;
	convertWithPowerPoint: (inputPath: string, outputPath: string) => Promise<void>;
};

let hooks: Hooks | null = null;

export function configureOfficePreview(next: Hooks | null): void {
	hooks = next;
	inFlight.clear();
	failed.clear();
}

/** Which program draws a file, judged from its name. Null for one neither does. */
export function officeRouteFor(fileName: string): OfficeRoute | null {
	const family = familyOf(fileName);
	if (family === "word" || family === "legacy-word") return "word";
	if (family === "presentation") return "powerpoint";
	return null;
}

/** The file to preview: a version Juno keeps, a file on disk, or bytes the window handed over. */
export interface OfficeSource {
	name: string;
	path: string | null;
	bytes: Uint8Array | null;
	/** Set for a version of a document, whose file never changes, so the PDF is kept by its id. */
	versionId: string | null;
}

export interface OfficePdf {
	pdf: Buffer;
	via: OfficeRoute;
	/** True when the PDF was read from the cache rather than made now. */
	cached: boolean;
}

const inFlight = new Map<string, Promise<OfficePdf | null>>();
/** Files a program could not convert, by cache key, until the next start. */
const failed = new Set<string>();
/** A machine that converts all day does not keep every failure forever. */
const MAX_FAILURES = 500;

function hashFile(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(path)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex")));
	});
}

async function subjectOf(source: OfficeSource): Promise<cache.CacheSubject> {
	if (source.versionId) return { versionId: source.versionId };
	if (source.bytes) return { hash: cache.hashOf(source.bytes) };
	return { hash: await hashFile(source.path!) };
}

async function convert(source: OfficeSource, route: OfficeRoute, configured: Hooks): Promise<Buffer> {
	const folder = await mkdtemp(join(tmpdir(), `juno-office-${randomBytes(4).toString("hex")}-`));
	try {
		// The copy is named by Juno. Its extension is what tells the program the format.
		const extension = safeExtensionOf(extensionOf(source.name));
		const input = join(folder, `preview${extension ? `.${extension}` : ""}`);
		const output = join(folder, "preview.pdf");
		if (source.bytes) await writeFile(input, source.bytes);
		else await copyFile(source.path!, input);
		await (route === "word" ? configured.convertWithWord(input, output) : configured.convertWithPowerPoint(input, output));
		const pdf = await readFile(output);
		if (!isPdfBytes(pdf)) throw new Error("The program did not write a PDF.");
		return pdf;
	} finally {
		await rm(folder, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * The PDF the file's own program makes of it, from the cache when it was made
 * before, or null when no program here draws it or the program failed. With
 * `convert: false` (a tile's picture) only the cache is read.
 */
export async function officePdf(source: OfficeSource, options: { convert?: boolean } = {}): Promise<OfficePdf | null> {
	const configured = hooks;
	const route = officeRouteFor(source.name);
	if (!configured || !route) return null;
	if (!source.path && !source.bytes) return null;
	const available = await (route === "word" ? configured.wordAvailable() : configured.powerpointAvailable()).catch(() => false);
	if (!available) return null;

	const subject = await subjectOf(source);
	const key = cache.cacheKey(subject);
	if (!key) return null;
	const kept = cache.read(subject);
	if (kept && isPdfBytes(kept)) return { pdf: kept, via: route, cached: true };
	if (options.convert === false || failed.has(key)) return null;

	const running = inFlight.get(key);
	if (running) return running;
	const work = convert(source, route, configured)
		.then((pdf): OfficePdf => {
			cache.write(subject, pdf);
			return { pdf, via: route, cached: false };
		})
		.catch(() => {
			if (failed.size >= MAX_FAILURES) failed.clear();
			failed.add(key);
			return null;
		})
		.finally(() => inFlight.delete(key));
	inFlight.set(key, work);
	return work;
}
