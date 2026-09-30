import { describe, expect, it } from "vitest";
import { SETTING_ENTRIES, searchSettings } from "./search";

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
