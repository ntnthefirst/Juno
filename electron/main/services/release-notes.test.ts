import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getAppPath: () => process.cwd() } }));

import { fromUpdateFeed, get, list, parseReleaseNotes } from "./release-notes";

const SAMPLE = `# Release notes

Intro that belongs to no version.

## 1.2.0
Released: 2027-01-05

Reminders can repeat. Mail loads faster.

### New
- Reminders repeat on the days you choose.

### Fixes
- A reminder no longer shows twice.

## 1.1.0

Only a summary here.
`;

describe("parseReleaseNotes", () => {
	it("reads the version, date, summary and sections", () => {
		const [first] = parseReleaseNotes(SAMPLE);
		expect(first).toEqual({
			version: "1.2.0",
			releasedAt: "2027-01-05",
			summary: "Reminders can repeat. Mail loads faster.",
			sections: [
				{ title: "New", items: ["Reminders repeat on the days you choose."] },
				{ title: "Fixes", items: ["A reminder no longer shows twice."] },
			],
		});
	});

	it("keeps an entry with no date and no sections", () => {
		const second = parseReleaseNotes(SAMPLE)[1];
		expect(second).toEqual({ version: "1.1.0", releasedAt: null, summary: "Only a summary here.", sections: [] });
	});

	it("reads Windows line endings and ignores headings that are not versions", () => {
		const notes = parseReleaseNotes(SAMPLE.replace(/\n/g, "\r\n") + "\n## Not a version\n- x\n");
		expect(notes.map((note) => note.version)).toEqual(["1.2.0", "1.1.0"]);
	});

	it("returns nothing for text with no entry", () => {
		expect(parseReleaseNotes("Just some words.")).toEqual([]);
	});
});

describe("fromUpdateFeed", () => {
	it("reads notes written in the shipped shape", () => {
		expect(fromUpdateFeed("1.2.0", SAMPLE)?.sections).toHaveLength(2);
	});

	it("accepts the per-version list the updater can return", () => {
		const note = fromUpdateFeed("1.2.0", [{ version: "1.2.0", note: SAMPLE }]);
		expect(note?.version).toBe("1.2.0");
	});

	it("reduces a hand-written release body to a plain summary", () => {
		const note = fromUpdateFeed("2.0.0", "<h2>What&#39;s new</h2><p>Faster <b>search</b>.</p>");
		expect(note).toEqual({ version: "2.0.0", releasedAt: null, summary: "What's new Faster search .", sections: [] });
	});

	it("returns null for empty or missing notes", () => {
		expect(fromUpdateFeed("1.0.0", null)).toBeNull();
		expect(fromUpdateFeed("1.0.0", "  ")).toBeNull();
		expect(fromUpdateFeed("1.0.0", "<p></p>")).toBeNull();
	});
});

describe("the shipped file", () => {
	const text = readFileSync(join(process.cwd(), "build", "release-notes.md"), "utf8");
	const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

	it("is listed newest first, with the running version on top", () => {
		const notes = list();
		expect(notes.length).toBeGreaterThan(0);
		expect(notes[0]?.version).toBe(version);
		expect(get(`v${version}`)?.version).toBe(version);
		expect(get("0.0.1")).toBeNull();
	});

	it("gives every entry a date, a summary and at least one item", () => {
		for (const note of list()) {
			expect(note.releasedAt, note.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(note.summary.length, note.version).toBeGreaterThan(0);
			expect(note.sections.length, note.version).toBeGreaterThan(0);
			for (const section of note.sections) {
				expect(["New", "Improvements", "Fixes"], note.version).toContain(section.title);
			}
		}
	});

	it("has each version once", () => {
		const versions = parseReleaseNotes(text).map((note) => note.version);
		expect(new Set(versions).size).toBe(versions.length);
	});

	it("keeps to the writing rules", () => {
		expect(text).not.toMatch(/[—–’‘“”…]|!/);
		expect(text).not.toMatch(
			/seamless|unlock|dive in|elevate|game.changer|supercharge|revolutioni|unleash|fast-paced|effortless|all-in-one|streamline your|anthropic/i,
		);
	});

	it("writes one sentence per item", () => {
		for (const note of list()) {
			for (const section of note.sections) {
				for (const item of section.items) {
					expect(item, `${note.version}: ${item}`).toMatch(/^[A-Z0-9].*\.$/);
					expect(item.length, item).toBeLessThanOrEqual(140);
				}
			}
		}
	});
});
