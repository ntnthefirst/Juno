import { describe, expect, it } from "vitest";
import { diffWords } from "./text-diff";

const marked = (before: string, after: string, limits?: Parameters<typeof diffWords>[2]) =>
	diffWords(before, after, limits)
		.parts.map((part) => (part.kind === "same" ? part.text : part.kind === "added" ? `+[${part.text}]` : `-[${part.text}]`))
		.join(" ");

describe("which words two texts do not share", () => {
	it("marks a word changed in the middle as one removed and one added", () => {
		expect(marked("De prijs is 100 euro per maand", "De prijs is 120 euro per maand")).toBe("De prijs is -[100] +[120] euro per maand");
	});

	it("marks a signature line added at the end, and counts the words", () => {
		const result = diffWords("Overeenkomst tussen partijen.", "Overeenkomst tussen partijen. Getekend te Gent");
		expect(result.parts.at(-1)).toEqual({ kind: "added", text: "Getekend te Gent", words: 3 });
		expect(result).toMatchObject({ added: 3, removed: 0, same: 3, truncated: false });
	});

	it("does not see other line breaks or spacing as a change", () => {
		const result = diffWords("een\ntwee   drie", "een twee\r\ndrie");
		expect(result).toMatchObject({ added: 0, removed: 0, same: 3 });
	});

	it("keeps the order of both texts across several changes", () => {
		expect(marked("a b c d e f", "a x c d f g")).toBe("a -[b] +[x] c d -[e] f +[g]");
	});

	it("handles an empty side", () => {
		expect(marked("", "alles nieuw")).toBe("+[alles nieuw]");
		expect(marked("alles weg", "")).toBe("-[alles weg]");
	});

	it("stays exact on a long text by anchoring on words that occur once, without a table that size", () => {
		const words = Array.from({ length: 6000 }, (_, i) => `w${i}`);
		const changed = [...words];
		changed[1000] = "nieuw";
		changed.splice(4000, 2);
		const result = diffWords(words.join(" "), changed.join(" "), { maxWords: 20_000, maxCells: 10_000 });
		expect(result).toMatchObject({ added: 1, removed: 3, same: 5997 });
	});

	it("cuts each side at the word limit and says so", () => {
		const result = diffWords("a b c d e", "a b c d e f", { maxWords: 3, maxCells: 100 });
		expect(result).toMatchObject({ added: 0, removed: 0, same: 3, truncated: true });
	});
});
