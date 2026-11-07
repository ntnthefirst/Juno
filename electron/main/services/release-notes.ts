/**
 * Release notes: what each version changed, for the person using Juno.
 *
 * One source, `build/release-notes.md`, shipped inside the package. It holds
 * every version, newest first, in a small fixed shape:
 *
 *   ## 1.0.0
 *   Released: 2026-11-07
 *
 *   A one or two sentence summary.
 *
 *   ### New
 *   - One plain sentence.
 *
 * `scripts/release-notes.mjs` copies the entry for the version being built into
 * the release feed (latest.yml), which is how the notes of a version that is
 * not installed yet reach a running copy. The updater hands them back as a
 * string, and `fromUpdateFeed` reads that string with the same parser.
 *
 * The rules for what an entry says are in .claude/rules/release-notes.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { ReleaseNote, ReleaseNoteSection } from "../../shared/types";

const VERSION = /^\d+\.\d+\.\d+$/;
const RELEASED = /^Released:\s*(\d{4}-\d{2}-\d{2})\s*$/;

/** Longest summary taken from a feed that does not use the shape above. */
const PLAIN_LIMIT = 600;

/** Reads the shape above. Text that holds no entry gives an empty list. */
export function parseReleaseNotes(text: string): ReleaseNote[] {
	const notes: ReleaseNote[] = [];
	const blocks = text.replace(/\r\n/g, "\n").split(/^## /m).slice(1);

	for (const block of blocks) {
		const lines = block.split("\n");
		const version = (lines.shift() ?? "").trim().replace(/^v/, "");
		if (!VERSION.test(version)) continue;

		let releasedAt: string | null = null;
		const summary: string[] = [];
		const sections: ReleaseNoteSection[] = [];
		let current: ReleaseNoteSection | null = null;

		for (const raw of lines) {
			const line = raw.trim();
			if (line === "") continue;

			const heading = /^### (.+)$/.exec(line);
			if (heading) {
				current = { title: heading[1]!.trim(), items: [] };
				sections.push(current);
				continue;
			}
			const released = RELEASED.exec(line);
			if (released && !current && summary.length === 0) {
				releasedAt = released[1]!;
				continue;
			}
			const item = /^[-*] (.+)$/.exec(line);
			if (item && current) {
				current.items.push(item[1]!.trim());
				continue;
			}
			if (!current) summary.push(line);
		}

		notes.push({
			version,
			releasedAt,
			summary: summary.join(" "),
			sections: sections.filter((section) => section.items.length > 0),
		});
	}

	return notes;
}

/** Newest first, by version number rather than by where the entry sits in the file. */
function byVersionDescending(a: ReleaseNote, b: ReleaseNote): number {
	const left = a.version.split(".").map(Number);
	const right = b.version.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const difference = (right[i] ?? 0) - (left[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

let cache: ReleaseNote[] | null = null;

function bundledPath(): string {
	return join(app.getAppPath(), "build", "release-notes.md");
}

/** Every version's notes shipped with this build, newest first. */
export function list(): ReleaseNote[] {
	if (cache) return cache;
	let text = "";
	try {
		text = readFileSync(bundledPath(), "utf8");
	} catch {
		// A build without the file shows an empty history rather than failing
		// the settings page it is read from.
	}
	cache = parseReleaseNotes(text).sort(byVersionDescending);
	return cache;
}

/** One version's notes, or null when this build holds none for it. */
export function get(version: string): ReleaseNote | null {
	const wanted = version.trim().replace(/^v/, "");
	return list().find((note) => note.version === wanted) ?? null;
}

/** What the updater calls the notes: a string, a list of per-version strings, or nothing. */
export type FeedNotes = string | { version?: string; note: string | null }[] | null | undefined;

function stripMarkup(text: string): string {
	return text
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The notes of a version found in the release feed. When the feed carries the
 * shape from this file they are read as written. Anything else, such as a
 * hand-written GitHub release body, is reduced to text and shown as the summary,
 * so a release published without proper notes still says something true.
 */
export function fromUpdateFeed(version: string, feed: FeedNotes): ReleaseNote | null {
	if (!feed) return null;
	const text = Array.isArray(feed) ? feed.map((entry) => entry.note ?? "").join("\n\n") : feed;
	if (text.trim() === "") return null;

	const parsed = parseReleaseNotes(text);
	const match = parsed.find((note) => note.version === version) ?? parsed[0];
	if (match) return match;

	const plain = stripMarkup(text);
	if (plain === "") return null;
	return {
		version,
		releasedAt: null,
		summary: plain.length > PLAIN_LIMIT ? `${plain.slice(0, PLAIN_LIMIT).trimEnd()}...` : plain,
		sections: [],
	};
}
