export type DayGroup<T> = { key: string; label: string; items: T[] };

const DAY = 24 * 60 * 60 * 1000;

/** Midnight at the start of the local day. Day boundaries are a display matter, so local. */
function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

type Bucket = { key: string; label: string };

/**
 * Where one moment falls, counted back from now: today, yesterday, the week,
 * the month, and after that a month of its own, with the year once it is not
 * this one.
 */
export function bucketOf(at: Date, now: Date): Bucket {
	const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
	if (days <= 0) return { key: "today", label: "Today" };
	if (days === 1) return { key: "yesterday", label: "Yesterday" };
	if (days < 7) return { key: "week", label: "Last 7 days" };
	if (days < 30) return { key: "month", label: "Last 30 days" };
	const sameYear = at.getFullYear() === now.getFullYear();
	return {
		key: `${at.getFullYear()}-${at.getMonth()}`,
		label: at.toLocaleDateString("en-GB", sameYear ? { month: "long" } : { month: "long", year: "numeric" }),
	};
}

/**
 * Splits a list into the groups a person reads it in: Today, Yesterday, Last 7
 * days and so on. The groups come in the order the items first appear, so a
 * newest-first list gives newest-first groups, and the order inside each group
 * is the order it came in.
 *
 * A moment that cannot be read goes in the oldest group rather than being
 * dropped, because a row that vanishes from a list is worse than one in the
 * wrong place.
 */
export function groupByDay<T>(items: T[], at: (item: T) => string, now: Date = new Date()): DayGroup<T>[] {
	const groups = new Map<string, DayGroup<T>>();
	for (const item of items) {
		const moment = new Date(at(item));
		const bucket = Number.isNaN(moment.getTime()) ? { key: "unknown", label: "Earlier" } : bucketOf(moment, now);
		const group = groups.get(bucket.key);
		if (group) group.items.push(item);
		else groups.set(bucket.key, { key: bucket.key, label: bucket.label, items: [item] });
	}
	return [...groups.values()];
}
