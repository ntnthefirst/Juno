import { describe, expect, it } from "vitest";
import { initialsOf, toneClassOf } from "./avatar-tone";

describe("initialsOf", () => {
	it("takes the first letter of the first two words", () => {
		expect(initialsOf("Jansen Bouwwerken BV")).toBe("JB");
		expect(initialsOf("Nathan Peeters")).toBe("NP");
	});

	it("takes the first two letters of a single word", () => {
		expect(initialsOf("bodhi")).toBe("BO");
	});

	it("reads a mail address as the name in front of it", () => {
		expect(initialsOf("laura.janssens@example.be")).toBe("LJ");
	});

	it("skips punctuation and digits that start a word", () => {
		expect(initialsOf("& Co. 2024 Studio")).toBe("CS");
	});

	it("keeps accented letters whole", () => {
		expect(initialsOf("Élodie Vandenberghe")).toBe("ÉV");
	});

	it("falls back to a question mark when there is no letter at all", () => {
		expect(initialsOf("")).toBe("?");
		expect(initialsOf("1234")).toBe("?");
	});
});

describe("toneClassOf", () => {
	it("gives the same name the same tint every time", () => {
		expect(toneClassOf("obet")).toBe(toneClassOf("obet"));
	});

	it("ignores case and the space around a name", () => {
		expect(toneClassOf("  Obet ")).toBe(toneClassOf("obet"));
	});

	it("uses more than one tint across a set of names", () => {
		const tints = new Set(["bodhi", "obet", "hyge", "noir", "Laura", "Tom", "Jansen"].map(toneClassOf));
		expect(tints.size).toBeGreaterThan(2);
	});

	it("only ever returns a tone class", () => {
		expect(toneClassOf("anything at all")).toMatch(/^bg-tone-[1-8] text-tone-[1-8]-ink$/);
	});
});
