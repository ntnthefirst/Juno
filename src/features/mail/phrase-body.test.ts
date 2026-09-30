import { describe, expect, it } from "vitest";
import { withPhrases } from "./phrase-body";

const QUOTE = "\n\nOp maandag schreef Laura:\n> Dag";

describe("the body a rule starts a message with", () => {
	it("leaves the body alone when nothing is added", () => {
		expect(withPhrases(null, null, "")).toBe("");
		expect(withPhrases(null, null, QUOTE)).toBe(QUOTE);
	});

	it("puts the greeting on top and leaves the writing place under it", () => {
		expect(withPhrases("Beste,", null, "")).toBe("Beste,\n\n");
	});

	it("puts the sign-off below one empty line to write on", () => {
		expect(withPhrases(null, "Groeten,\nNathan", "")).toBe("\n\nGroeten,\nNathan");
	});

	it("puts a blank line, the writing line and a blank line between the two", () => {
		expect(withPhrases("Beste,", "Groeten", "")).toBe("Beste,\n\n\n\nGroeten");
	});

	it("keeps the quoted original last, below the sign-off", () => {
		const body = withPhrases("Beste,", "Groeten", QUOTE);
		expect(body.startsWith("Beste,")).toBe(true);
		expect(body.indexOf("Groeten")).toBeLessThan(body.indexOf("Op maandag"));
		expect(body.endsWith(QUOTE)).toBe(true);
		expect(body).toBe(`Beste,\n\n\n\nGroeten${QUOTE}`);
	});

	it("separates text that does not start on a new line from the sign-off", () => {
		expect(withPhrases(null, "Groeten", "Zie bijlage.")).toBe("\n\nGroeten\n\nZie bijlage.");
	});
});
