import { describe, expect, it } from "vitest";
import { firstPageOf, GROUPS, pageById, pageOfAnchor, PAGES, pagesOf } from "./pages";
import { isNear, locationOf, queryWords, SETTING_ENTRIES, searchSettings } from "./search";

// The renderer has no filesystem, so the sources come in through Vite.
const files = import.meta.glob(
	["../../app/SettingsWindow.tsx", "../agent/ConnectionPanel.tsx", "./*.tsx"],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** Every file that can draw a section a search result points at. */
function sources(): string {
	return Object.values(files).join("\n");
}

describe("settings search", () => {
	it("points every entry at a section that exists", () => {
		const text = sources();
		for (const entry of SETTING_ENTRIES) {
			const drawn = text.includes(`anchor="${entry.anchor}"`) || text.includes(`data-setting="${entry.anchor}"`);
			expect(drawn, `no section draws the anchor "${entry.anchor}"`).toBe(true);
		}
	});

	it("finds a setting by a word that is not in its title", () => {
		expect(searchSettings("screensaver")[0]?.anchor).toBe("lock");
		expect(searchSettings("dark mode")[0]?.anchor).toBe("appearance");
		expect(searchSettings("btw")[0]?.anchor).toBe("owner-details");
		expect(searchSettings("imap")[0]?.anchor).toBe("mail-accounts");
		expect(searchSettings("restore")[0]?.anchor).toBe("removed-accounts");
	});

	it("needs every word of the query to land", () => {
		expect(searchSettings("pin nonsenseword")).toEqual([]);
		expect(searchSettings("   ")).toEqual([]);
	});

	it("ignores accents and case", () => {
		expect(searchSettings("THEMÉ")[0]?.anchor).toBe("appearance");
	});

	it("does not match a short word in the middle of another", () => {
		const hits = searchSettings("pin").map((entry) => entry.anchor);
		expect(hits).toContain("lock");
		expect(hits).not.toContain("updates");
	});
});

describe("settings pages", () => {
	it("sends every entry to a page, in the group the entry names", () => {
		for (const entry of SETTING_ENTRIES) {
			const page = pageOfAnchor(entry.anchor);
			expect(page, `no page draws "${entry.anchor}"`).not.toBeNull();
			expect(page?.group, `"${entry.title}" says ${entry.tab} but its page is in ${page?.group}`).toBe(entry.tab);
		}
	});

	it("draws every anchor a page lists", () => {
		const text = sources();
		for (const page of PAGES) {
			for (const anchor of page.anchors) {
				const drawn = text.includes(`anchor="${anchor}"`) || text.includes(`data-setting="${anchor}"`);
				expect(drawn, `page "${page.id}" lists "${anchor}" and nothing draws it`).toBe(true);
			}
		}
	});

	it("gives a page one anchor only when its section may drop the heading", () => {
		for (const page of PAGES.filter((candidate) => candidate.solo)) {
			expect(page.anchors, `"${page.id}" is solo with several sections`).toHaveLength(1);
		}
	});

	it("opens every group on a page of its own", () => {
		for (const group of GROUPS) {
			expect(pagesOf(group.id).length, `${group.id} has no pages`).toBeGreaterThan(0);
			expect(pageById(firstPageOf(group.id)).group).toBe(group.id);
		}
	});

	it("lists no anchor twice, so a result has one place to go", () => {
		const anchors = PAGES.flatMap((page) => page.anchors);
		expect(new Set(anchors).size).toBe(anchors.length);
	});
});

describe("settings search, further", () => {
	it("finds a setting through a slip of the finger", () => {
		expect(searchSettings("lokc")[0]?.anchor).toBe("lock");
		expect(searchSettings("theem")[0]?.anchor).toBe("appearance");
		expect(searchSettings("passwrd").map((entry) => entry.anchor)).toContain("lock");
	});

	it("does not let a typo outrank a word that matched as typed", () => {
		const hits = searchSettings("backup");
		expect(hits[0]?.anchor).toBe("backup");
	});

	it("leaves short words alone, so a typo is never a guess at three letters", () => {
		expect(searchSettings("lck")).toEqual([]);
	});

	it("says where a result lives", () => {
		const signature = SETTING_ENTRIES.find((entry) => entry.anchor === "signature")!;
		expect(locationOf(signature)).toBe("Documents > Signature image");
		const mail = SETTING_ENTRIES.find((entry) => entry.anchor === "mail-accounts")!;
		expect(locationOf(mail)).toBe("Mail accounts");
	});

	it("says one slip apart the way a person would", () => {
		expect(isNear("lock", "lokc")).toBe(true);
		expect(isNear("lock", "loc")).toBe(true);
		expect(isNear("lock", "locks")).toBe(true);
		expect(isNear("lock", "luck")).toBe(true);
		expect(isNear("lock", "back")).toBe(false);
		expect(isNear("lock", "lckx")).toBe(false);
	});

	it("splits a query into the words that are highlighted", () => {
		expect(queryWords("  Dark  MODE ")).toEqual(["dark", "mode"]);
		expect(queryWords("")).toEqual([]);
	});
});
