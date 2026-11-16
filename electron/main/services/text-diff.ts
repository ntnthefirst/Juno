/**
 * Which words two texts share and which one of them adds or leaves out, for
 * showing a person why two files are nearly the same (decision 39 matches
 * them by their words; this says which words).
 *
 * Words are compared as they are written, with any run of white space between
 * them counting as one space, so a file re-saved with other line breaks shows
 * no change. The work is bounded: each side is cut at `maxWords`, the shared
 * start and end are taken off first, words that occur once on each side
 * anchor the rest (patience diff), and only a gap between anchors small
 * enough for a table is compared word by word. A gap too large for that is
 * shown as removed and added whole, which is still the truth, only coarser.
 *
 * No Electron import, so every rule here is covered by a test.
 */
import type { TextDiffPart } from "../../shared/types";

export const DIFF_LIMITS = {
	/** Words read from each side. A contract is a few thousand. */
	maxWords: 20_000,
	/** Cells of the word-by-word table for one gap between anchors. */
	maxCells: 2_000_000,
};

type Op = { kind: TextDiffPart["kind"]; word: string };

export function wordsOf(text: string): string[] {
	return text.split(/\s+/).filter((word) => word.length > 0);
}

/** The shortest edit for a small gap: a longest-common-subsequence table. */
function table(a: string[], b: string[], out: Op[]): void {
	const n = a.length;
	const m = b.length;
	const width = m + 1;
	const lengths = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			lengths[i * width + j] =
				a[i] === b[j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
		}
	}
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ kind: "same", word: a[i]! });
			i += 1;
			j += 1;
		} else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
			out.push({ kind: "removed", word: a[i]! });
			i += 1;
		} else {
			out.push({ kind: "added", word: b[j]! });
			j += 1;
		}
	}
	for (; i < n; i += 1) out.push({ kind: "removed", word: a[i]! });
	for (; j < m; j += 1) out.push({ kind: "added", word: b[j]! });
}

/** Words that occur exactly once on each side, as pairs of positions in `a` order. */
function uniquePairs(a: string[], b: string[]): Array<[number, number]> {
	const inA = new Map<string, number>();
	for (let i = 0; i < a.length; i += 1) inA.set(a[i]!, inA.has(a[i]!) ? -1 : i);
	const inB = new Map<string, number>();
	for (let j = 0; j < b.length; j += 1) inB.set(b[j]!, inB.has(b[j]!) ? -1 : j);
	const pairs: Array<[number, number]> = [];
	for (const [word, i] of inA) {
		const j = inB.get(word);
		if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
	}
	return pairs.sort((x, y) => x[0] - y[0]);
}

/** The longest run of pairs that rises in `b` as it rises in `a`: the anchors both texts keep in order. */
function rising(pairs: Array<[number, number]>): Array<[number, number]> {
	const tails: number[] = [];
	const before = new Int32Array(pairs.length).fill(-1);
	for (let k = 0; k < pairs.length; k += 1) {
		const j = pairs[k]![1];
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (pairs[tails[mid]!]![1] < j) low = mid + 1;
			else high = mid;
		}
		if (low > 0) before[k] = tails[low - 1]!;
		tails[low] = k;
	}
	const chain: Array<[number, number]> = [];
	for (let k = tails.length > 0 ? tails[tails.length - 1]! : -1; k >= 0; k = before[k]!) chain.push(pairs[k]!);
	return chain.reverse();
}

function diffRange(a: string[], b: string[], out: Op[], limits: typeof DIFF_LIMITS): void {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		out.push({ kind: "same", word: a[start]! });
		start += 1;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA -= 1;
		endB -= 1;
	}
	const middleA = a.slice(start, endA);
	const middleB = b.slice(start, endB);
	const tail = a.slice(endA);

	if (middleA.length === 0 || middleB.length === 0 || middleA.length * middleB.length <= limits.maxCells) {
		table(middleA, middleB, out);
	} else {
		const anchors = rising(uniquePairs(middleA, middleB));
		if (anchors.length === 0) {
			for (const word of middleA) out.push({ kind: "removed", word });
			for (const word of middleB) out.push({ kind: "added", word });
		} else {
			let i = 0;
			let j = 0;
			for (const [anchorA, anchorB] of anchors) {
				diffRange(middleA.slice(i, anchorA), middleB.slice(j, anchorB), out, limits);
				out.push({ kind: "same", word: middleA[anchorA]! });
				i = anchorA + 1;
				j = anchorB + 1;
			}
			diffRange(middleA.slice(i), middleB.slice(j), out, limits);
		}
	}
	for (const word of tail) out.push({ kind: "same", word });
}

export interface WordDiff {
	parts: TextDiffPart[];
	added: number;
	removed: number;
	same: number;
	/** A side was longer than `maxWords`, so only its start was compared. */
	truncated: boolean;
}

/** What `after` adds to `before` and leaves out of it, word by word, as runs of one kind. */
export function diffWords(before: string, after: string, limits: typeof DIFF_LIMITS = DIFF_LIMITS): WordDiff {
	const allA = wordsOf(before);
	const allB = wordsOf(after);
	const a = allA.slice(0, limits.maxWords);
	const b = allB.slice(0, limits.maxWords);
	const ops: Op[] = [];
	diffRange(a, b, ops, limits);

	const parts: TextDiffPart[] = [];
	const counts = { added: 0, removed: 0, same: 0 };
	for (const op of ops) {
		counts[op.kind] += 1;
		const last = parts[parts.length - 1];
		if (last && last.kind === op.kind) {
			last.text += ` ${op.word}`;
			last.words += 1;
		} else {
			parts.push({ kind: op.kind, text: op.word, words: 1 });
		}
	}
	return { parts, ...counts, truncated: allA.length > a.length || allB.length > b.length };
}
