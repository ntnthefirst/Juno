/**
 * The cache of preview PDFs (decision 83): a hit, a miss, the ceiling pruned
 * oldest first, and a deleted version taking its PDF with it.
 */
import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cachedVersionIds,
	cacheKey,
	configurePreviewCache,
	forgetDeletedVersions,
	forgetVersion,
	hashOf,
	prune,
	read,
	write,
} from "./preview-cache";

const PDF = (fill: number, size = 100) => new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(size, fill)]));
const VERSION = "01970000-0000-7000-8000-000000000001";

function fresh(maxBytes?: number): string {
	const directory = mkdtempSync(join(tmpdir(), "juno-preview-cache-"));
	configurePreviewCache(maxBytes === undefined ? { directory } : { directory, maxBytes });
	return directory;
}

afterEach(() => configurePreviewCache(null));

describe("the preview cache", () => {
	it("misses, then hits with the same bytes it kept", () => {
		fresh();
		expect(read({ versionId: VERSION })).toBeNull();
		write({ versionId: VERSION }, PDF(1));
		expect(new Uint8Array(read({ versionId: VERSION })!)).toEqual(PDF(1));

		const hash = hashOf(new Uint8Array([1, 2, 3]));
		expect(read({ hash })).toBeNull();
		write({ hash }, PDF(2));
		expect(new Uint8Array(read({ hash })!)).toEqual(PDF(2));
	});

	it("names a PDF by an id or a hash, never by anything that could be a path", () => {
		expect(cacheKey({ versionId: VERSION })).toMatch(/^v1-[0-9a-f-]+$/);
		expect(cacheKey({ versionId: "..\\..\\juno" })).toBeNull();
		expect(cacheKey({ hash: "not-a-hash" })).toBeNull();
		expect(cacheKey({ hash: hashOf(new Uint8Array()) })).toMatch(/^h1-[0-9a-f]{64}$/);
	});

	it("keeps nothing and reads nothing while it is switched off", () => {
		configurePreviewCache(null);
		write({ versionId: VERSION }, PDF(1));
		expect(read({ versionId: VERSION })).toBeNull();
	});

	it("prunes the PDFs looked at longest ago until it is under its ceiling", () => {
		const directory = fresh(2000);
		const ids = ["01970000-0000-7000-8000-00000000000a", "01970000-0000-7000-8000-00000000000b", "01970000-0000-7000-8000-00000000000c"];
		ids.forEach((versionId, at) => {
			write({ versionId }, PDF(at, 400));
			// Older to newer by a minute each, so the order does not depend on the clock's resolution.
			const when = new Date(Date.now() - (ids.length - at) * 60_000);
			utimesSync(join(directory, `${cacheKey({ versionId })}.pdf`), when, when);
		});
		// Reading the oldest makes it the newest, so the second one goes instead.
		expect(read({ versionId: ids[0]! })).not.toBeNull();
		expect(prune(1000)).toBe(1);
		expect(cachedVersionIds().sort()).toEqual([ids[0], ids[2]].sort());
	});

	it("clears what is not a PDF of its own format, such as a part a crash left", () => {
		const directory = fresh();
		writeFileSync(join(directory, "v0-old.pdf"), "old");
		writeFileSync(join(directory, "h1-abc.pdf.123.part"), "half");
		write({ versionId: VERSION }, PDF(1));
		expect(readdirSync(directory)).toEqual([`${cacheKey({ versionId: VERSION })}.pdf`]);
	});

	it("does not keep a PDF larger than the whole ceiling", () => {
		fresh(50);
		write({ versionId: VERSION }, PDF(1, 100));
		expect(read({ versionId: VERSION })).toBeNull();
	});

	it("drops a deleted version's PDF, at once and at the next start", () => {
		const directory = fresh();
		const gone = "01970000-0000-7000-8000-0000000000d1";
		const kept = "01970000-0000-7000-8000-0000000000d2";
		const later = "01970000-0000-7000-8000-0000000000d3";
		for (const versionId of [gone, kept, later]) write({ versionId }, PDF(1));

		forgetVersion(gone);
		expect(existsSync(join(directory, `${cacheKey({ versionId: gone })}.pdf`))).toBe(false);

		// Deleted while the cache was not told: the next start asks which still exist.
		const asked: string[][] = [];
		const removed = forgetDeletedVersions((ids) => {
			asked.push(ids);
			return new Set([kept]);
		});
		expect(removed).toBe(1);
		expect(asked[0]!.sort()).toEqual([kept, later].sort());
		expect(cachedVersionIds()).toEqual([kept]);
	});
});
