import { describe, expect, it } from "vitest";
import type { TextDiffPart } from "@shared/types";
import { CONTEXT_WORDS, diffSegments, diffSummary } from "./diff-runs";

const same = (count: number, from = 0): TextDiffPart => ({
	kind: "same",
	text: Array.from({ length: count }, (_, i) => `w${from + i}`).join(" "),
	words: count,
});

describe("the differences view", () => {
	it("folds a long shared stretch between two changes and keeps the words beside each", () => {
		const parts: TextDiffPart[] = [{ kind: "added", text: "x", words: 1 }, same(100), { kind: "removed", text: "y", words: 1 }];
		const segments = diffSegments(parts);
		expect(segments.map((segment) => segment.kind)).toEqual(["added", "same", "hidden", "same", "removed"]);
		expect(segments[2]).toEqual({ kind: "hidden", index: 1, words: 100 - 2 * CONTEXT_WORDS });
		expect(segments[1]).toEqual({ kind: "same", text: same(CONTEXT_WORDS).text });
	});

	it("keeps only the words before the first change and after the last", () => {
		const segments = diffSegments([same(100), { kind: "added", text: "x", words: 1 }, same(100)]);
		expect(segments.map((segment) => segment.kind)).toEqual(["hidden", "same", "added", "same", "hidden"]);
	});

	it("leaves a short stretch whole, and unfolds one the person opened", () => {
		expect(diffSegments([same(20), { kind: "added", text: "x", words: 1 }]).map((segment) => segment.kind)).toEqual(["same", "added"]);
		const parts: TextDiffPart[] = [{ kind: "added", text: "x", words: 1 }, same(100)];
		expect(diffSegments(parts, new Set([1])).map((segment) => segment.kind)).toEqual(["added", "same"]);
	});

	it("says how many words changed", () => {
		expect(diffSummary(12, 4)).toBe("12 words added and 4 removed.");
		expect(diffSummary(1, 0)).toBe("1 word added.");
		expect(diffSummary(0, 3)).toBe("3 words removed.");
		expect(diffSummary(0, 0)).toMatch(/same/);
	});
});
