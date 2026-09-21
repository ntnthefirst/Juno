import type { CalendarItem, CalendarOccurrence } from "@shared/types";
import { addDays, dateOf, daysBetween, localDateOfInstant, localMinuteOfInstant } from "./dates";

/** Something drawn on one day of the grid. A multi-day item is placed once per day. */
export type Placed = {
	key: string;
	item: CalendarItem;
	date: string;
	/** Drawn in the all-day row: all-day events, reminders and deadlines. */
	dated: boolean;
	/** Minutes since local midnight, clipped to the day. Zero and 1440 for a dated item. */
	startMinute: number;
	endMinute: number;
	/** True on every day but the first. */
	continued: boolean;
	/** True on every day but the last. */
	continues: boolean;
};

export function itemKey(item: CalendarItem): string {
	switch (item.kind) {
		case "event":
			return `event|${item.eventId}|${item.occurrenceStartLocal}`;
		case "reminder":
			return `reminder|${item.reminderId}`;
		case "deadline":
			return `deadline|${item.projectId}`;
	}
}

export function itemTitle(item: CalendarItem): string {
	return item.kind === "deadline" ? `${item.projectName} due` : item.title;
}

export function isOccurrence(item: CalendarItem): item is CalendarOccurrence {
	return item.kind === "event";
}

/**
 * Places every item on the local dates it covers.
 *
 * Timed events are placed by their instants in the machine's zone, which is
 * the zone the grid is drawn in. Dated items are placed by their dates as
 * written, because a date has no zone to convert through.
 */
export function placeItems(items: CalendarItem[], from: string, to: string): Map<string, Placed[]> {
	const byDate = new Map<string, Placed[]>();
	const put = (placed: Placed) => {
		if (placed.date < from || placed.date > to) return;
		const list = byDate.get(placed.date) ?? [];
		list.push(placed);
		byDate.set(placed.date, list);
	};

	for (const item of items) {
		const key = itemKey(item);
		if (item.kind !== "event") {
			put({ key, item, date: item.dueOn, dated: true, startMinute: 0, endMinute: 1440, continued: false, continues: false });
			continue;
		}
		if (item.allDay) {
			const first = dateOf(item.startLocal);
			const last = addDays(dateOf(item.endLocal), -1);
			const span = Math.max(0, daysBetween(first, last));
			for (let i = 0; i <= span; i++) {
				put({
					key,
					item,
					date: addDays(first, i),
					dated: true,
					startMinute: 0,
					endMinute: 1440,
					continued: i > 0,
					continues: i < span,
				});
			}
			continue;
		}
		const firstDate = localDateOfInstant(item.startUtc);
		const startMinute = localMinuteOfInstant(item.startUtc);
		// The end is exclusive, so an event ending at midnight belongs to the day
		// before: the last day is the day the minute before the end falls on.
		const startMs = new Date(item.startUtc).getTime();
		const endMs = new Date(item.endUtc).getTime();
		const lastDate = localDateOfInstant(new Date(endMs > startMs ? endMs - 60_000 : endMs).toISOString());
		const endsAtMidnight = localDateOfInstant(item.endUtc) !== lastDate;
		const lastEndMinute = endsAtMidnight ? 1440 : localMinuteOfInstant(item.endUtc);
		const span = Math.max(0, daysBetween(firstDate, lastDate));
		for (let i = 0; i <= span; i++) {
			const from = i === 0 ? startMinute : 0;
			const to = i === span ? Math.max(lastEndMinute, from) : 1440;
			put({
				key,
				item,
				date: addDays(firstDate, i),
				dated: false,
				startMinute: from,
				endMinute: to,
				continued: i > 0,
				continues: i < span,
			});
		}
	}

	for (const list of byDate.values()) {
		list.sort((a, b) => {
			if (a.dated !== b.dated) return a.dated ? -1 : 1;
			if (a.startMinute !== b.startMinute) return a.startMinute - b.startMinute;
			return itemTitle(a.item).localeCompare(itemTitle(b.item));
		});
	}
	return byDate;
}

/** Tone is a token name, never a hex. See brand/BRAND.md section 5. */
export function chipTone(item: CalendarItem): string {
	switch (item.kind) {
		case "event":
			return "bg-[var(--accent-soft)] text-[var(--accent)]";
		case "reminder":
			return item.bucket === "overdue"
				? "bg-[var(--risk-soft)] text-[var(--risk)]"
				: "bg-[var(--warn-soft)] text-[var(--warn)]";
		case "deadline":
			return "bg-[var(--seal-soft)] text-[var(--seal)]";
	}
}

/** The strong colour of the same pair, for a dot beside a row. */
export function dotTone(item: CalendarItem): string {
	switch (item.kind) {
		case "event":
			return "bg-[var(--accent)]";
		case "reminder":
			return item.bucket === "overdue" ? "bg-[var(--risk)]" : "bg-[var(--warn)]";
		case "deadline":
			return "bg-[var(--seal)]";
	}
}

export const KIND_LABELS: Record<CalendarItem["kind"], string> = {
	event: "Event",
	reminder: "Reminder",
	deadline: "Project deadline",
};

/**
 * Lays overlapping timed items out side by side within a day column. Items
 * that overlap form a cluster; each cluster is split into as many lanes as
 * its widest overlap needs.
 */
export function laneLayout(placed: Placed[]): Map<string, { lane: number; lanes: number }> {
	const out = new Map<string, { lane: number; lanes: number }>();
	const timed = placed.filter((p) => !p.dated).sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

	let cluster: Placed[] = [];
	let clusterEnd = -1;
	const flush = () => {
		const laneEnds: number[] = [];
		const lanes = new Map<string, number>();
		for (const p of cluster) {
			let lane = laneEnds.findIndex((end) => end <= p.startMinute);
			if (lane === -1) {
				lane = laneEnds.length;
				laneEnds.push(p.endMinute);
			} else {
				laneEnds[lane] = p.endMinute;
			}
			lanes.set(p.key, lane);
		}
		for (const p of cluster) out.set(p.key, { lane: lanes.get(p.key) ?? 0, lanes: laneEnds.length });
		cluster = [];
	};

	for (const p of timed) {
		if (cluster.length > 0 && p.startMinute >= clusterEnd) flush();
		cluster.push(p);
		clusterEnd = Math.max(clusterEnd, Math.max(p.endMinute, p.startMinute + 15));
	}
	if (cluster.length > 0) flush();
	return out;
}
