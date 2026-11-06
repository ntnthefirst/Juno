const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** When a record was opened, in the words a menu has room for: Today, Yesterday, Mon, 3 Oct. */
export function recentDay(iso: string, now: Date = new Date()): string {
	const opened = new Date(iso);
	const days = Math.round((startOfDay(now) - startOfDay(opened)) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return WEEKDAY.format(opened);
	return DAY_MONTH.format(opened);
}
