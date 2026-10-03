import { useCallback } from "react";
import type { CalendarItem } from "@shared/types";
import { requestOpen } from "../../lib/open-entity";
import { useLoaded } from "../../lib/use-loaded";
import { addDays, describeDue } from "../reminders/format";
import { Card, CardError, CardLink, CardNote, GroupLabel } from "./Card";

type UpNextCardProps = {
	/** Today as `YYYY-MM-DD`. Null until the screen has read the clock. */
	today: string | null;
};

/** The day an item falls on, and the clock time it starts, when it has one. */
function whenOf(item: CalendarItem): { date: string; time: string } {
	if (item.kind === "event") {
		return { date: item.startLocal.slice(0, 10), time: item.allDay ? "" : item.startLocal.slice(11, 16) };
	}
	return { date: item.dueOn, time: "" };
}

function titleOf(item: CalendarItem): string {
	return item.kind === "deadline" ? item.projectName : item.title;
}

function detailOf(item: CalendarItem): string {
	if (item.kind === "deadline") return ["Deadline", item.clientName].filter(Boolean).join(" · ");
	if (item.kind === "event") return [item.allDay ? "All day" : "", item.location, item.clientName].filter(Boolean).join(" · ");
	return item.clientName ?? "";
}

function keyOf(item: CalendarItem): string {
	if (item.kind === "event") return `event:${item.eventId}:${item.occurrenceStartLocal}`;
	if (item.kind === "deadline") return `deadline:${item.projectId}`;
	return `reminder:${item.reminderId}`;
}

/** Today and Tomorrow in words, then the weekday and date: "Wednesday 7 Oct". */
function dayLabel(date: string, today: string): string {
	const near = describeDue(date, today);
	if (near === "Today" || near === "Tomorrow") return near;
	const [year, month, day] = date.split("-").map(Number);
	if (!year || !month || !day) return date;
	return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});
}

/**
 * The next seven days of appointments and project deadlines, split by day.
 * Reminders are left out on purpose: they have their own card beside it, and
 * showing them twice would make the page look busier than the week is.
 */
export function UpNextCard({ today }: UpNextCardProps) {
	const load = useCallback(
		() =>
			today
				? window.juno.calendar.list({ from: today, to: addDays(today, 6), includeDeadlines: true })
				: Promise.resolve<CalendarItem[]>([]),
		[today],
	);
	const state = useLoaded(load);

	const openCalendar = () => requestOpen({ kind: "screen", screen: "calendar" });

	const items =
		state.status === "ready"
			? state.value
					.filter((item) => item.kind !== "reminder")
					.map((item) => ({ item, ...whenOf(item) }))
					.sort((a, b) => `${a.date}${a.time || "00:00"}`.localeCompare(`${b.date}${b.time || "00:00"}`))
			: [];
	const days = [...new Set(items.map((entry) => entry.date))];

	return (
		<Card title="Up next" action={<CardLink label="Calendar" onClick={openCalendar} />}>
			<CardError what="your calendar" state={state} />
			{state.status === "loading" || !today ? (
				<CardNote>Loading.</CardNote>
			) : state.status === "ready" && items.length === 0 ? (
				<CardNote>Nothing planned for the next seven days.</CardNote>
			) : (
				days.map((date) => (
					<div key={date}>
						<GroupLabel>{dayLabel(date, today)}</GroupLabel>
						{items
							.filter((entry) => entry.date === date)
							.map(({ item, time }) => (
								<button
									key={keyOf(item)}
									type="button"
									onClick={openCalendar}
									className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
								>
									<span
										aria-hidden
										className={`h-8 w-1 flex-none rounded-[var(--radius-full)] ${item.kind === "deadline" ? "bg-[var(--warn)]" : "bg-[var(--accent)]"}`}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[length:var(--text-base)]">{titleOf(item)}</span>
										<span className="block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{detailOf(item) || " "}
										</span>
									</span>
									<span className="tabular flex-none text-[length:var(--text-dense)] text-[var(--ink-muted)]">
										{time}
									</span>
								</button>
							))}
					</div>
				))
			)}
		</Card>
	);
}
