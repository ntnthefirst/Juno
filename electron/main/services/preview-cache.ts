/**
 * The PDFs Word and PowerPoint made of a file for its preview (decision 83),
 * kept so the second look at the same file is instant.
 *
 * - **A folder of its own under the data folder**, `preview-cache`, handed in
 *   at startup. Never beside a document: the documents folder holds what the
 *   person keeps, and nothing here is theirs.
 * - **Named by what the PDF is of.** A version of a document by its id, which
 *   never changes what it holds (a version's file is never written to), and
 *   anything else (a mail attachment, a project's file, bytes about to be
 *   added) by the hash of its bytes. The name is built here from those, never
 *   from a file name.
 * - **A ceiling on its size.** Past it, the PDFs looked at longest ago go
 *   first. Reading one marks it as looked at.
 * - **A deleted version takes its PDF with it**, at once when it is deleted
 *   here and at the next start for one deleted any other way.
 *
 * No Electron import and no database, so every rule here is tested in plain
 * Node.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Enough for a few hundred contracts and decks, and small next to the documents themselves. */
export const MAX_CACHE_BYTES = 512 * 1024 * 1024;

/**
 * Bumped when the way a PDF is made changes, so what an older Juno wrote is
 * left to be pruned rather than shown.
 */
const FORMAT = "1";

let directory: string | null = null;
let ceiling = MAX_CACHE_BYTES;

/** Where the cache lives, and its ceiling. Null switches it off: nothing is read or kept. */
export function configurePreviewCache(next: { directory: string; maxBytes?: number } | null): void {
	directory = next?.directory ?? null;
	ceiling = next?.maxBytes ?? MAX_CACHE_BYTES;
	if (directory && !existsSync(directory)) mkdirSync(directory, { recursive: true });
}

/** What a cached PDF is of. */
export type CacheSubject = { versionId: string } | { hash: string };

const VERSION_ID = /^[0-9a-f-]{1,64}$/i;
const HASH = /^[0-9a-f]{64}$/;

/** The name a subject's PDF is kept under, or null for one that is not an id or a hash. */
export function cacheKey(subject: CacheSubject): string | null {
	if ("versionId" in subject) return VERSION_ID.test(subject.versionId) ? `v${FORMAT}-${subject.versionId.toLowerCase()}` : null;
	return HASH.test(subject.hash) ? `h${FORMAT}-${subject.hash}` : null;
}

/** The hash a subject that is not a version is kept by. */
export function hashOf(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function pathFor(key: string): string | null {
	return directory ? join(directory, `${key}.pdf`) : null;
}

/** The PDF kept for a subject, or null. Reading one counts as using it, for pruning. */
export function read(subject: CacheSubject): Buffer | null {
	const key = cacheKey(subject);
	const path = key ? pathFor(key) : null;
	if (!path || !existsSync(path)) return null;
	try {
		const bytes = readFileSync(path);
		const clock = new Date();
		utimesSync(path, clock, clock);
		return bytes;
	} catch {
		return null;
	}
}

/**
 * Keeps the PDF for a subject, then prunes. Written under a temporary name and
 * renamed, so a read never sees half a file.
 */
export function write(subject: CacheSubject, pdf: Uint8Array): void {
	const key = cacheKey(subject);
	const path = key ? pathFor(key) : null;
	if (!path) return;
	// One PDF larger than the whole ceiling would only be pruned again at once.
	if (pdf.byteLength > ceiling) return;
	const partial = `${path}.${process.pid}.part`;
	try {
		writeFileSync(partial, pdf);
		renameSync(partial, path);
	} catch {
		rmSync(partial, { force: true });
		return;
	}
	prune();
}

interface Entry {
	name: string;
	path: string;
	size: number;
	used: number;
}

function entries(): Entry[] {
	if (!directory || !existsSync(directory)) return [];
	const found: Entry[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		try {
			const stat = statSync(path);
			if (stat.isFile()) found.push({ name, path, size: stat.size, used: stat.mtimeMs });
		} catch {
			// Gone between the listing and the look.
		}
	}
	return found;
}

/**
 * Removes the PDFs looked at longest ago until the cache is within its
 * ceiling, and anything that is not a PDF of this format (a part left by a
 * crash, an older format). Returns how many files went.
 */
export function prune(maxBytes = ceiling): number {
	const all = entries();
	const current = new RegExp(`^[vh]${FORMAT}-[0-9a-f-]+\\.pdf$`);
	let removed = 0;
	const kept: Entry[] = [];
	for (const entry of all) {
		if (current.test(entry.name)) kept.push(entry);
		else {
			rmSync(entry.path, { force: true });
			removed += 1;
		}
	}
	kept.sort((a, b) => a.used - b.used);
	let total = kept.reduce((sum, entry) => sum + entry.size, 0);
	for (const entry of kept) {
		if (total <= maxBytes) break;
		rmSync(entry.path, { force: true });
		total -= entry.size;
		removed += 1;
	}
	return removed;
}

/** Drops the PDF of one version, when the version is deleted. */
export function forgetVersion(versionId: string): void {
	const key = cacheKey({ versionId });
	const path = key ? pathFor(key) : null;
	if (path) rmSync(path, { force: true });
}

/** The version ids the cache holds a PDF for. */
export function cachedVersionIds(): string[] {
	const prefix = `v${FORMAT}-`;
	return entries()
		.map((entry) => entry.name)
		.filter((name) => name.startsWith(prefix) && name.endsWith(".pdf"))
		.map((name) => name.slice(prefix.length, -".pdf".length));
}

/** Drops the PDF of every cached version `alive` says no longer exists. Returns how many went. */
export function forgetDeletedVersions(alive: (versionIds: string[]) => Set<string>): number {
	const cached = cachedVersionIds();
	if (cached.length === 0) return 0;
	const living = alive(cached);
	let removed = 0;
	for (const id of cached) {
		if (living.has(id)) continue;
		forgetVersion(id);
		removed += 1;
	}
	return removed;
}
