/**
 * Static strings, so Tailwind sees every class. A class assembled from the
 * tone number would never be generated.
 */
const TONES = [
	"bg-tone-1 text-tone-1-ink",
	"bg-tone-2 text-tone-2-ink",
	"bg-tone-3 text-tone-3-ink",
	"bg-tone-4 text-tone-4-ink",
	"bg-tone-5 text-tone-5-ink",
	"bg-tone-6 text-tone-6-ink",
	"bg-tone-7 text-tone-7-ink",
	"bg-tone-8 text-tone-8-ink",
];

/** Up to two letters: the first of the first two words, or the first two of a single one. */
export function initialsOf(name: string): string {
	const words = name.split(/[\s@._-]+/).filter((word) => /\p{L}/u.test(word));
	const letters = words.map((word) => Array.from(word.replace(/[^\p{L}]/gu, ""))[0] ?? "");
	if (letters.length === 0) return "?";
	if (letters.length === 1) return Array.from(words[0]!.replace(/[^\p{L}]/gu, "")).slice(0, 2).join("").toUpperCase();
	return `${letters[0]}${letters[1]}`.toUpperCase();
}

/**
 * The tint classes for a name. The same name is always the same tint, on every
 * screen and every launch, because it is worked out from the letters and
 * remembers nothing.
 */
export function toneClassOf(name: string): string {
	let hash = 0;
	for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
	return TONES[hash % TONES.length]!;
}
