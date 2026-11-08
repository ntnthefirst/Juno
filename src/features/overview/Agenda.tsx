import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AgentAction, AgentActionView, CalendarItem, Reminder } from "@shared/types";
import { Icon } from "../../components/Icon";
import { requestOpen } from "../../lib/open-entity";
import { useLoaded } from "../../lib/use-loaded";
import { timeAgo } from "../agent/format";
import { toolVisual, VERBS } from "../agent/tool-visual";
import { useNow } from "../agent/use-now";
import { addDays, describeDue } from "../reminders/format";
import { ReminderRow } from "../reminders/ReminderRow";

type AgendaProps = {
	/** Today as `YYYY-MM-DD`. Null until the screen has read the clock. */
	today: string | null;
	reminders: Reminder[];
	/** Requests an agent made that wait for an answer. */
	requests: AgentAction[];
	/** Reminders and requests are still being read. */
	loading: boolean;
	onChanged: () => void;
	onEdit: (reminder: Reminder) => void;
	onSnooze: (reminder: Reminder) => void;
	onDeleted: (reminder: Reminder) => void;
	onError: (message: string) => void;
};

/** What each waiting request is called, from the same words the Agent screen uses. */
function useRequestTitles(requests: AgentAction[]): Map<string, string> {
	const [titles, setTitles] = useState<Map<string, string>>(new Map());
	const key = requests.map((action) => action.id).join(",");
	useEffect(() => {
		if (key === "") return;
		let cancelled = false;
		window.juno.agent.actions
			.describe(key.split(","))
			.then((views: AgentActionView[]) => {
				if (!cancelled) setTitles(new Map(views.map((view) => [view.actionId, view.title])));
			})
			.catch(() => {
				// The stored sentence still reads as a request.
			});
		return () => {
			cancelled = true;
		};
	}, [key]);
	return titles;
}

type Entry = {
	key: string;
	/** `overdue`, or the `YYYY-MM-DD` the entry falls on. */
	group: string;
	/** Where it sits inside its day: requests, reminders, then what is scheduled. */
	order: number;
	/** `HH:MM`, to put events in time order. Empty sorts first. */
	time: string;
	/** The date the entry is for, so an overdue group can say since when. */
	date: string;
	node: ReactNode;
};

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A plain date split without a zone, so no offset can move the day. */
function split(date: string): { weekday: number; day: number; month: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) return null;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	return { weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(), day, month };
}

function shortDate(date: string, withWeekday: boolean): string {
	const parts = split(date);
	if (!parts) return date;
	const text = `${parts.day} ${MONTHS[parts.month - 1] ?? ""}`;
	return withWeekday ? `${WEEKDAYS[parts.weekday] ?? ""} ${text}` : text;
}

function dayLabel(date: string, today: string): { title: string; sub: string } {
	if (date === today) return { title: "Today", sub: shortDate(date, true) };
	const parts = split(date);
	if (!parts) return { title: date, sub: "" };
	const week = date < addDays(today, 7);
	return week
		? { title: WEEKDAYS_LONG[parts.weekday] ?? date, sub: shortDate(date, false) }
		: { title: shortDate(date, false), sub: WEEKDAYS_LONG[parts.weekday] ?? "" };
}

function whenOf(item: CalendarItem): { date: string; time: string } {
	if (item.kind === "event" || item.kind === "subscription") {
		return { date: item.startLocal.slice(0, 10), time: item.allDay ? "" : item.startLocal.slice(11, 16) };
	}
	return { date: item.dueOn, time: "" };
}

function metaOf(item: CalendarItem): string {
	if (item.kind === "deadline") return ["Deadline", item.clientName].filter(Boolean).join(" · ");
	if (item.kind === "event") {
		return [item.allDay ? "All day" : "", item.location, item.clientName].filter(Boolean).join(" · ");
	}
	if (item.kind === "subscription") return item.subscriptionName;
	return item.clientName ?? "";
}

const ROW = "flex min-h-14 w-full items-center gap-4 border-b border-line py-3 text-left";

/**
 * Coming up: overdue, today and the days after it in one list, with the day at
 * the left. Reminders, an agent's waiting requests, appointments and project
 * deadlines share a row, and the lead says which is which: a round check, a
 * spark, a bar.
 */
export function Agenda({
	today,
	reminders,
	requests,
	loading,
	onChanged,
	onEdit,
	onSnooze,
	onDeleted,
	onError,
}: AgendaProps) {
	const now = useNow();
	const titles = useRequestTitles(requests);
	const load = useCallback(
		() =>
			today
				? window.juno.calendar.list({ from: today, to: addDays(today, 6), includeDeadlines: true })
				: Promise.resolve<CalendarItem[]>([]),
		[today],
	);
	const calendar = useLoaded(load);

	const openCalendar = () => requestOpen({ kind: "screen", screen: "calendar" });
	const openAgent = () => requestOpen({ kind: "screen", screen: "agent" });

	const entries: Entry[] = [];
	if (today) {
		for (const action of requests) {
			const style = VERBS[toolVisual(action.toolName).verb];
			entries.push({
				key: `request:${action.id}`,
				group: today,
				order: 0,
				time: "",
				date: today,
				node: (
					<button type="button" onClick={openAgent} className={ROW}>
						<span className="flex h-8 w-6 flex-none items-center justify-center">
							<span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
								<Icon name="agent" size={14} />
							</span>
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-base">{titles.get(action.id) ?? action.summary}</span>
							<span className="block truncate text-sm text-ink-muted">
								{style.label} · asked {now === null ? "" : timeAgo(action.createdAt, now)}
							</span>
						</span>
						<span className="flex-none text-base font-[var(--weight-medium)] text-accent">Review</span>
					</button>
				),
			});
		}
		for (const reminder of reminders) {
			const overdue = reminder.bucket === "overdue";
			entries.push({
				key: `reminder:${reminder.id}`,
				group: overdue ? "overdue" : reminder.dueOn,
				order: 1,
				time: "",
				date: reminder.dueOn,
				node: (
					<ReminderRow
						reminder={reminder}
						today={today}
						variant="agenda"
						trailing={
							reminder.dueOn > today
								? describeDue(reminder.dueOn, today)
								: overdue
									? shortDate(reminder.dueOn, false)
									: "Today"
						}
						onChanged={onChanged}
						onEdit={onEdit}
						onSnooze={onSnooze}
						onDeleted={onDeleted}
						onError={onError}
					/>
				),
			});
		}
		const scheduled =
			calendar.status === "ready"
				? calendar.value
						.filter((item): item is Extract<CalendarItem, { kind: "event" | "deadline" }> => item.kind === "event" || item.kind === "deadline")
						.map((item) => ({ item, ...whenOf(item) }))
				: [];
		for (const { item, date, time } of scheduled) {
			if (date < today) continue;
			const title = item.kind === "deadline" ? item.projectName : item.title;
			entries.push({
				key: item.kind === "event" ? `event:${item.eventId}:${item.occurrenceStartLocal}` : `deadline:${item.projectId}`,
				group: date,
				order: 2,
				time,
				date,
				node: (
					<button type="button" onClick={openCalendar} className={ROW}>
						<span className="flex h-8 w-6 flex-none items-center justify-center">
							<span aria-hidden className="h-8 w-[3px] rounded-[var(--radius-sm)] bg-accent" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-base">{title}</span>
							<span className="block truncate text-sm text-ink-muted">{metaOf(item) || " "}</span>
						</span>
						<span className="flex-none text-base tabular-nums text-ink">{time}</span>
					</button>
				),
			});
		}
	}

	const keys = [...new Set(entries.map((entry) => entry.group))].sort((a, b) =>
		a === "overdue" ? -1 : b === "overdue" ? 1 : a.localeCompare(b),
	);

	if (loading || !today || calendar.status === "loading") {
		return (
			<div role="status" aria-label="Loading" className="mt-2 flex flex-col">
				{[0, 1, 2].map((row) => (
					<div key={row} className="flex h-14 items-center gap-4 border-b border-line">
						<span className="h-6 w-6 animate-pulse rounded-[var(--radius-full)] bg-sunken" />
						<span className="h-3 w-2/5 animate-pulse rounded-[var(--radius-sm)] bg-sunken" />
					</div>
				))}
			</div>
		);
	}

	return (
		<div>
			{calendar.status === "error" ? (
				<p data-selectable className="mb-2 border-l-2 border-risk pl-3 text-dense text-risk">
					Could not load your calendar. {calendar.message}
				</p>
			) : null}
			{keys.length === 0 ? (
				<p className="py-6 text-base text-ink-muted">Nothing is coming up in the next seven days.</p>
			) : null}
			{keys.map((key) => {
				const group = entries
					.filter((entry) => entry.group === key)
					.sort((a, b) => a.order - b.order || a.time.localeCompare(b.time));
				const overdue = key === "overdue";
				const oldest = overdue ? (group.map((entry) => entry.date).sort()[0] ?? today) : key;
				const label = overdue ? { title: "Overdue", sub: shortDate(oldest, true) } : dayLabel(key, today);
				return (
					<div key={key} className="flex gap-6">
						<div className="w-[120px] flex-none py-3">
							<p className={`text-base font-[var(--weight-semibold)] ${overdue ? "text-risk" : "text-ink"}`}>
								{label.title}
							</p>
							<p className="text-sm text-ink-muted">{label.sub}</p>
						</div>
						<div className="min-w-0 flex-1">
							{group.map((entry) => (
								<div key={entry.key}>{entry.node}</div>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
