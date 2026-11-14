import type { TextDiffPart } from "@shared/types";

/** Words of shared text kept on each side of a change, so the change reads in its sentence. */
export const CONTEXT_WORDS = 12;

export type DiffSegment =
	| { kind: "added" | "removed" | "same"; text: string }
	/** Shared words left out between two changes, shown as a count that opens them. */
	| { kind: "hidden"; index: number; words: number };

/**
 * What the differences view draws: every change in full, the shared words
 * close to a change, and the long stretches of shared text between changes
 * folded to a count. `open` holds the stretches the person has unfolded, by
 * the part's index.
 */
export function diffSegments(parts: readonly TextDiffPart[], open: ReadonlySet<number> = new Set()): DiffSegment[] {
	const out: DiffSegment[] = [];
	parts.forEach((part, index) => {
		if (part.kind !== "same" || open.has(index)) {
			out.push({ kind: part.kind, text: part.text });
			return;
		}
		const first = index === 0;
		const last = index === parts.length - 1;
		const keep = (first ? 0 : CONTEXT_WORDS) + (last ? 0 : CONTEXT_WORDS);
		// Folding saves nothing when what would be hidden is shorter than a line.
		if (part.words <= keep + CONTEXT_WORDS) {
			out.push({ kind: "same", text: part.text });
			return;
		}
		const words = part.text.split(" ");
		const head = first ? [] : words.slice(0, CONTEXT_WORDS);
		const tail = last ? [] : words.slice(words.length - CONTEXT_WORDS);
		if (head.length > 0) out.push({ kind: "same", text: head.join(" ") });
		out.push({ kind: "hidden", index, words: words.length - head.length - tail.length });
		if (tail.length > 0) out.push({ kind: "same", text: tail.join(" ") });
	});
	return out;
}

/** "12 words added and 4 removed", the sentence above the view. */
export function diffSummary(added: number, removed: number): string {
	const count = (n: number) => `${n} ${n === 1 ? "word" : "words"}`;
	if (added === 0 && removed === 0) return "The words are the same. Only the layout or the file differs.";
	if (removed === 0) return `${count(added)} added.`;
	if (added === 0) return `${count(removed)} removed.`;
	return `${count(added)} added and ${removed} removed.`;
}
