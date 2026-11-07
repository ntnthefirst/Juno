import { useEffect, useState } from "react";
import type { CalendarItem } from "@shared/types";
import { Button } from "../../components/Button";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { addDays, formatTime, localDateOfInstant, todayIso } from "../calendar/dates";
import { editScheduleForm, type ScheduleForm } from "../calendar/schedule-form";
import { dayLabel } from "./time-format";

type ProjectCalendarProps = {
	projectId: string;
	/** Bumped by the page after a form page saved, so the lists read again. */
	version: number;
	onAddEvent: () => void;
	/** Hands a form up to the screen, which draws it as a page. */
	onOpenForm: (form: ScheduleForm) => void;
};

type Row = {
	key: string;
	kind: "event" | "reminder";
	id: string;
	title: string;
	date: string;
	/** HH:MM, or empty for a reminder and an all-day event. */
	time: string;
	detail: string;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; upcoming: Row[]; past: Row[] }
	| { status: "error"; message: string };

/** Events once each, as their first occurrence in range, and reminders as they are. */
function rowsOf(items: CalendarItem[], today: string): { upcoming: Row[]; past: Row[] } {
	const upcoming = new Map<string, Row>();
	const past = new Map<string, Row>();

	for (const item of items) {
		if (item.kind === "reminder") {
			const row: Row = {
				key: `reminder|${item.reminderId}`,
				kind: "reminder",
				id: item.reminderId,
				title: item.title,
				date: item.dueOn,
				time: "",
				detail: [dayLabel(item.dueOn), item.clientName, "reminder"].filter(Boolean).join(", "),
			};
			// An open reminder that is overdue is still something to do, not history.
			(item.dueOn >= today || item.bucket === "overdue" ? upcoming : past).set(row.key, row);
			continue;
		}
		if (item.kind !== "event") continue;
		const date = item.allDay ? item.startLocal.slice(0, 10) : localDateOfInstant(item.startUtc);
		const endDate = item.allDay ? item.endLocal.slice(0, 10) : localDateOfInstant(item.endUtc);
		const over = item.allDay ? endDate <= today : endDate < today;
		const row: Row = {
			key: `event|${item.eventId}`,
			kind: "event",
			id: item.eventId,
			title: item.title,
			date,
			time: item.allDay ? "" : formatTime(item.startUtc),
			detail: [dayLabel(date), item.clientName].filter(Boolean).join(", "),
		};
		const target = over ? past : upcoming;
		// A series is one line: its next occurrence going forward, its latest going back.
		if (!target.has(row.key) || (over && date > (target.get(row.key)?.date ?? ""))) target.set(row.key, row);
	}

	const sorted = (rows: Map<string, Row>, direction: 1 | -1) =>
		[...rows.values()].sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -direction : direction));
	return { upcoming: sorted(upcoming, 1), past: sorted(past, -1) };
}

type GroupProps = { title: string; rows: Row[]; onOpen: (row: Row) => void };

function Group({ title, rows, onOpen }: GroupProps) {
	if (rows.length === 0) return null;
	return (
		<div className="mt-4">
			<p className="px-1 text-sm text-[var(--ink-muted)]">{title}</p>
			<ul className="mt-1 flex flex-col">
				{rows.map((row) => (
					<li key={row.key}>
						<button
							type="button"
							onClick={() => onOpen(row)}
							className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-1 py-2 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						>
							<span aria-hidden className="h-9 w-0.5 flex-none rounded-[var(--radius-full)] bg-[var(--accent)]" />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-base font-[var(--weight-medium)]">{row.title}</span>
								<span className="block truncate text-sm text-[var(--ink-muted)]">{row.detail}</span>
							</span>
							<span className="tabular flex-none text-base">{row.time}</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * What is planned for the project and what has happened on it: the dates and
 * reminders that carry its id, which is the same data the calendar shows. Both
 * lists open the same form page the calendar does.
 */
export function ProjectCalendar({ projectId, version, onAddEvent, onOpenForm }: ProjectCalendarProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const today = todayIso();
		window.juno.calendar
			.list({
				from: addDays(today, -180),
				to: addDays(today, 219),
				includeReminders: true,
				projectId,
			})
			.then((items) => {
				if (!cancelled) setLoad({ status: "ready", ...rowsOf(items, today) });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, version]);

	function open(row: Row) {
		editScheduleForm({ kind: row.kind, id: row.id })
			.then(onOpenForm)
			.catch((cause: unknown) => setNotice(messageOf(cause)));
	}

	return (
		<section className="min-h-[320px] rounded-[var(--radius-lg)] border border-[var(--line)] p-5">
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-baseline gap-3">
					<h2 className="text-base font-[var(--weight-medium)]">Calendar</h2>
					<span className="text-sm text-[var(--ink-muted)]">Events and reminders linked to this project</span>
				</div>
				<Button size="dense" onClick={onAddEvent}>
					Add event
				</Button>
			</div>

			{load.status === "loading" ? (
				<p className="mt-3 text-sm text-[var(--ink-muted)]">Loading.</p>
			) : load.status === "error" ? (
				<p data-selectable className="mt-3 text-sm text-[var(--risk)]">
					{load.message}
				</p>
			) : load.upcoming.length === 0 && load.past.length === 0 ? (
				<p className="mt-3 text-sm text-[var(--ink-muted)]">
					Nothing planned. Add an event for a meeting or a delivery.
				</p>
			) : (
				<>
					<Group title="Upcoming" rows={load.upcoming} onOpen={open} />
					<Group title="Past" rows={load.past} onOpen={open} />
				</>
			)}

			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</section>
	);
}
