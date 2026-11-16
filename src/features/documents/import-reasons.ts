import type { ImportAnalysis, ImportMatch } from "@shared/types";

/**
 * Why a file is shown beside a document already in Juno, in the words the
 * comparison says it: the same bytes, the same text, or only the same name
 * (decision 39). The person decides each time; this only says what was seen.
 */
export function reasonFor(match: ImportMatch): string {
	if (match.identical) return `This exact file is already a version of ${match.title}`;
	if (match.reason === "bytes") return `The same file as ${match.title}`;
	if (match.reason === "text") {
		const share = Math.round(match.score * 100);
		return share >= 99 ? `Same text as ${match.title}` : `Same text as ${match.title}, ${share}% of it`;
	}
	return `Same name as ${match.title}`;
}

/** Whether a file can go straight in, or has to be shown beside what it looks like first. */
export function needsAsking(analysis: Pick<ImportAnalysis, "matches">): boolean {
	return analysis.matches.length > 0;
}

/** The match to compare with first: one it could still become a version of, best first. */
export function firstMatch(analysis: Pick<ImportAnalysis, "matches">): ImportMatch | null {
	return analysis.matches.find((match) => !match.identical) ?? analysis.matches[0] ?? null;
}
