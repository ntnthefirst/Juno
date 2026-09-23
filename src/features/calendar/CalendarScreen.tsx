import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarEvent, CalendarItem, CalendarOccurrence, CalendarScope } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { AgendaView } from "./AgendaView";
import {
	addDays,
	addLocalDays,
	addLocalMinutes,
	addMonths,
	formatDayShort,
	formatMinutes,
	joinLocal,
	localMinutesBetween,
	monthGrid,
	monthLabel,
	todayIso,
	weekDays,
	weekLabel,
	type ViewKind,
} from "./dates";
import { EventDetail } from "./EventDetail";
import { EventForm, type EventSeed } from "./EventForm";
import { placeItems } from "./format";
import { MonthView } from "./MonthView";
import { ScopeDialog } from "./ScopeDialog";
import { WeekView } from "./WeekView";

type Load =
	| { status: "loading" }
	| { status: "ready"; items: CalendarItem[] }
	| { status: "error"; message: string };

type FormState = {
	event: CalendarEvent | null;
	occurrence: CalendarOccurrence | null;
	scope: CalendarScope;
	seed: EventSeed | null;
};

type ScopeQuestion = {
	verb: string;
	title: string;
	then: (scope: CalendarScope) => void;
};

const AGENDA_DAYS = 30;

const VIEW_OPTIONS: { kind: ViewKind; label: string; short: string }[] = [
	{ kind: "month", label: "Month", short: "M" },
	{ kind: "week", label: "Week", short: "W" },
	{ kind: "agenda", label: "Agenda", short: "A" },
];

/** The current minute, for the week view's line. Impure, so read in an effect. */
function minuteNow(): number {
	const d = new Date();
	return d.getHours() * 60 + d.getMinutes();
}

export function CalendarScreen() {
	const [today, setToday] = useState<string | null>(null);
	const [nowMinute, setNowMinute] = useState<number | null>(null);
	const [view, setView] = useState<ViewKind>("month");
	const [anchor, setAnchor] = useState<string | null>(null);
	const [showReminders, setShowReminders] = useState(true);
	const [showDeadlines, setShowDeadlines] = useState(true);
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [version, setVersion] = useState(0);
	const [form, setForm] = useState<FormState | null>(null);
	const [detail, setDetail] = useState<CalendarItem | null>(null);
	const [question, setQuestion] = useState<ScopeQuestion | null>(null);
	const [deleted, setDeleted] = useState<CalendarEvent | null>(null);
	const [warnings, setWarnings] = useState<string[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// The clock is impure, so it is read here and kept current by the minute.
	useEffect(() => {
		const tick = () => {
			const date = todayIso();
			setToday(date);
			setNowMinute(minuteNow());
			// The first tick also opens the calendar on today.
			setAnchor((current) => current ?? date);
		};
		const first = window.setTimeout(tick, 0);
		const interval = window.setInterval(tick, 60_000);
		return () => {
			window.clearTimeout(first);
			window.clearInterval(interval);
		};
	}, []);

	const dates = useMemo(() => {
		if (!anchor) return [];
		if (view === "month") return monthGrid(anchor);
		if (view === "week") return weekDays(anchor);
		return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(anchor, i));
	}, [anchor, view]);

	const from = dates[0];
	const to = dates[dates.length - 1];

	const fetchItems = useCallback(() => {
		if (!from || !to) return Promise.resolve<CalendarItem[]>([]);
		return window.juno.calendar.list({
			from,
			to,
			includeReminders: showReminders,
			includeDeadlines: showDeadlines,
		});
	}, [from, to, showReminders, showDeadlines]);

	useEffect(() => {
		if (!from) return;
		let cancelled = false;
		fetchItems()
			.then((items) => {
				if (!cancelled) setLoad({ status: "ready", items });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchItems, from, version]);

	const refresh = useCallback(() => setVersion((v) => v + 1), []);

	const placed = useMemo(
		() => (load.status === "ready" && from && to ? placeItems(load.items, from, to) : new Map()),
		[load, from, to],
	);

	function step(direction: -1 | 1) {
		if (!anchor) return;
		if (view === "month") setAnchor(addMonths(anchor, direction));
		else if (view === "week") setAnchor(addDays(anchor, 7 * direction));
		else setAnchor(addDays(anchor, AGENDA_DAYS * direction));
	}

	async function run(work: () => Promise<unknown>, done?: string) {
		try {
			await work();
			refresh();
			if (done) setNotice(done);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	/** Asks the recurrence question for a series, or answers "all" for a single event. */
	function withScope(item: CalendarOccurrence, verb: string, then: (scope: CalendarScope) => void) {
		if (!item.isRecurring) {
			then("all");
			return;
		}
		setQuestion({ verb, title: item.title, then });
	}

	function createAt(date: string, minute: number | null) {
		const seed: EventSeed =
			minute === null
				? { startLocal: date, endLocal: addDays(date, 1), allDay: true }
				: {
						startLocal: joinLocal(date, formatMinutes(minute)),
						endLocal: addLocalMinutes(joinLocal(date, formatMinutes(minute)), 60),
						allDay: false,
					};
		setForm({ event: null, occurrence: null, scope: "all", seed });
	}

	async function edit(item: CalendarOccurrence) {
		setDetail(null);
		let event: CalendarEvent | null;
		try {
			event = await window.juno.calendar.get(item.eventId);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
			return;
		}
		if (!event) {
			setNotice("That event no longer exists.");
			refresh();
			return;
		}
		withScope(item, "edit", (scope) => {
			setQuestion(null);
			setForm({ event, occurrence: item, scope, seed: null });
		});
	}

	function remove(item: CalendarOccurrence) {
		setDetail(null);
		withScope(item, "delete", (scope) => {
			setQuestion(null);
			void run(async () => {
				const result = await window.juno.calendar.remove(item.eventId, {
					scope,
					occurrenceStartLocal: item.occurrenceStartLocal,
				});
				// Only a whole removal can be undone; the other two edit the series.
				if (result.deletedAt) setDeleted(result);
			});
		});
	}

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		setDeleted(null);
		await run(() => window.juno.calendar.restore(id));
	}

	/** A drag, turned into a wall-clock edit on the event's own zone. */
	function move(item: CalendarOccurrence, dayDelta: number, minuteDelta: number) {
		const shift = (local: string) =>
			item.allDay ? addLocalDays(local, dayDelta) : addLocalMinutes(local, dayDelta * 1440 + minuteDelta);
		withScope(item, "move", (scope) => {
			setQuestion(null);
			void run(async () => {
				if (scope === "all") {
					// The whole series shifts by the same amount, so the master moves
					// by the delta rather than to where this occurrence was dropped.
					const event = await window.juno.calendar.get(item.eventId);
					if (!event) throw new Error("That event no longer exists.");
					await window.juno.calendar.update(event.id, { startLocal: shift(event.startLocal) }, { scope: "all" });
					return;
				}
				await window.juno.calendar.update(
					item.eventId,
					{ startLocal: shift(item.startLocal) },
					{ scope, occurrenceStartLocal: item.occurrenceStartLocal },
				);
			});
		});
	}

	function resize(item: CalendarOccurrence, minuteDelta: number) {
		if (item.allDay) return;
		const endLocal = addLocalMinutes(item.endLocal, minuteDelta);
		if (localMinutesBetween(item.startLocal, endLocal) < 15) return;
		withScope(item, "resize", (scope) => {
			setQuestion(null);
			void run(async () => {
				if (scope === "all") {
					const event = await window.juno.calendar.get(item.eventId);
					if (!event) throw new Error("That event no longer exists.");
					await window.juno.calendar.update(
						event.id,
						{ endLocal: addLocalMinutes(event.endLocal, minuteDelta) },
						{ scope: "all" },
					);
					return;
				}
				await window.juno.calendar.update(
					item.eventId,
					{ endLocal },
					{ scope, occurrenceStartLocal: item.occurrenceStartLocal },
				);
			});
		});
	}

	async function importIcs() {
		try {
			const result = await window.juno.calendar.importIcs();
			if (!result) return;
			refresh();
			const parts = [
				result.created ? `${result.created} added` : null,
				result.updated ? `${result.updated} updated` : null,
				result.skipped ? `${result.skipped} skipped` : null,
			].filter(Boolean);
			setNotice(parts.length > 0 ? `Imported: ${parts.join(", ")}.` : "Nothing to import.");
			if (result.warnings.length > 0) setWarnings(result.warnings);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function exportIcs() {
		if (!from || !to) return;
		try {
			const path = await window.juno.calendar.exportIcs({ from, to });
			if (path) setNotice(`Saved ${path}.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	const dismissNotice = useCallback(() => setNotice(null), []);
	const dismissUndo = useCallback(() => setDeleted(null), []);

	const heading =
		!anchor || !from || !to
			? ""
			: view === "month"
				? monthLabel(anchor)
				: view === "week"
					? weekLabel(anchor)
					: `${formatDayShort(from)} to ${formatDayShort(to)} ${to.slice(0, 4)}`;

	// The form replaces the calendar rather than covering it. There is nothing
	// behind it worth reading while filling it in, and a month grid seen through
	// a dimmed overlay is just a month grid you cannot click.
	if (form) {
		return (
			<EventForm
				event={form.event}
				occurrence={form.occurrence}
				scope={form.scope}
				seed={form.seed}
				onClose={() => setForm(null)}
				onSaved={() => {
					setForm(null);
					refresh();
				}}
			/>
		);
	}

	const overflowItems: MenuItem[] = [
		{ id: "import", label: "Import", icon: "import", onSelect: () => void importIcs() },
		{
			id: "export",
			label: "Export",
			icon: "export",
			disabled: load.status !== "ready",
			onSelect: () => void exportIcs(),
		},
		{
			id: "reminders",
			label: "Reminders",
			icon: "reminders",
			hint: showReminders ? "Shown" : "Hidden",
			separatorBefore: true,
			onSelect: () => setShowReminders((v) => !v),
		},
		{
			id: "deadlines",
			label: "Deadlines",
			icon: "flag",
			hint: showDeadlines ? "Shown" : "Hidden",
			onSelect: () => setShowDeadlines((v) => !v),
		},
	];

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-none min-w-0 items-center gap-2 border-b border-[var(--line)] px-4 py-3 sm:gap-3 sm:px-6">
				<h1 className="min-w-0 shrink truncate text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
					{heading}
				</h1>
				<div className="flex shrink-0 items-center gap-1">
					<Button size="dense" onClick={() => step(-1)} aria-label="Previous">
						{"<"}
					</Button>
					<Button size="dense" onClick={() => today && setAnchor(today)}>
						Today
					</Button>
					<Button size="dense" onClick={() => step(1)} aria-label="Next">
						{">"}
					</Button>
				</div>

				<div
					className="flex shrink-0 items-center gap-px rounded-[var(--radius-md)] bg-[var(--sunken)] p-px"
					role="group"
					aria-label="View"
				>
					{VIEW_OPTIONS.map((option) => (
						<button
							key={option.kind}
							type="button"
							aria-pressed={view === option.kind}
							// Both labels are in the DOM and CSS picks one, so the button
							// needs a name of its own: without it a screen reader reads the
							// long one and the short one together, as "Week W".
							aria-label={option.label}
							title={option.label}
							onClick={() => setView(option.kind)}
							className={`h-[30px] rounded-[var(--radius-md)] px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								view === option.kind ? "bg-[var(--surface)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
							}`}
						>
							<span aria-hidden className="hidden sm:inline">
								{option.label}
							</span>
							<span aria-hidden className="sm:hidden">
								{option.short}
							</span>
						</button>
					))}
				</div>

				<div className="ml-auto flex shrink-0 items-center gap-1">
					<Button
						variant="primary"
						size="dense"
						aria-label="New event"
						title="New event"
						onClick={() => anchor && createAt(view === "month" ? (today ?? anchor) : anchor, 9 * 60)}
					>
						<Icon name="add" />
					</Button>
					<MenuButton items={overflowItems} ariaLabel="More" icon="more" />
				</div>
			</div>

			<div className="relative flex min-h-0 flex-1">
				<div className="min-w-0 flex-1 overflow-hidden">
				{load.status === "error" ? (
					<div className="m-8 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the calendar.</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{load.message}
						</p>
					</div>
				) : !anchor || !today ? null : view === "month" ? (
					<MonthView
						dates={dates}
						month={anchor.slice(0, 7)}
						today={today}
						placed={placed}
						onOpen={setDetail}
						onCreateAt={(date) => createAt(date, 9 * 60)}
						onOpenDay={(date) => {
							setAnchor(date);
							setView("week");
						}}
						onMove={(item, dayDelta) => move(item, dayDelta, 0)}
						onEdit={(item) => void edit(item)}
						onDelete={(item) => remove(item)}
						onStep={step}
					/>
				) : view === "week" ? (
					<WeekView
						dates={dates}
						today={today}
						placed={placed}
						nowMinute={nowMinute}
						onOpen={setDetail}
						onCreateAt={createAt}
						onMove={move}
						onResize={resize}
						onEdit={(item) => void edit(item)}
						onDelete={(item) => remove(item)}
						onStep={step}
					/>
				) : (
					<AgendaView
						dates={dates}
						today={today}
						placed={placed}
						onOpen={setDetail}
						onEdit={(item) => void edit(item)}
						onDelete={(item) => remove(item)}
						onStep={step}
					/>
				)}
				</div>

				{detail ? (
					<EventDetail
						item={detail}
						onClose={() => setDetail(null)}
						onEdit={() => {
							if (detail.kind === "event") void edit(detail);
						}}
						onDelete={() => {
							if (detail.kind === "event") remove(detail);
						}}
					/>
				) : null}
			</div>

			{question ? (
				<ScopeDialog verb={question.verb} title={question.title} onChoose={question.then} onClose={() => setQuestion(null)} />
			) : null}

			{warnings ? (
				<Dialog title="Imported with warnings" onClose={() => setWarnings(null)}>
					<ul className="mt-4 flex flex-col gap-2 text-[length:var(--text-dense)]">
						{warnings.map((warning, index) => (
							<li key={index} className="border-l-2 border-[var(--warn)] pl-3">
								{warning}
							</li>
						))}
					</ul>
					<div className="mt-6 flex justify-end">
						<Button variant="primary" onClick={() => setWarnings(null)}>
							Close
						</Button>
					</div>
				</Dialog>
			) : null}

			{deleted ? (
				<Toast message={`${deleted.title} deleted.`} actionLabel="Undo" onAction={() => void restore()} onDismiss={dismissUndo} />
			) : null}

			{deleted === null && notice ? <Toast message={notice} onDismiss={dismissNotice} /> : null}
		</div>
	);
}
