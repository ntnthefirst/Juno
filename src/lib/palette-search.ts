export type Rankable = {
	label: string;
	/** Words that should find it without being on it: "settings" for Preferences. */
	keywords?: string;
};

/**
 * Orders and filters what the palette offers for what was typed.
 *
 * Every word typed has to be found somewhere in the label or its keywords, so
 * "new cl" finds "New client" and "cl new" does too. Within what is found, a
 * label that starts with the word beats one where a word inside it starts with
 * the word, which beats one that only contains it, which beats a keyword. Ties
 * keep the order they came in, so the commands stay where they were written.
 *
 * No query is no filter: the list is returned as it was given.
 */
export function rank<T extends Rankable>(items: T[], query: string): T[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return items;

	const scored: { item: T; score: number; order: number }[] = [];
	items.forEach((item, order) => {
		const label = item.label.toLowerCase();
		const keywords = (item.keywords ?? "").toLowerCase();
		let total = 0;
		for (const word of words) {
			const score = scoreWord(label, keywords, word);
			if (score === 0) return;
			total += score;
		}
		scored.push({ item, score: total, order });
	});

	return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.item);
}

function scoreWord(label: string, keywords: string, word: string): number {
	if (label.startsWith(word)) return 4;
	if (label.split(/[\s/-]+/).some((part) => part.startsWith(word))) return 3;
	if (label.includes(word)) return 2;
	if (keywords.includes(word)) return 1;
	return 0;
}
