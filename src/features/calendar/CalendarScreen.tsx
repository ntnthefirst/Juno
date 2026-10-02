import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	CalendarEvent,
	CalendarItem,
	CalendarOccurrence,
	CalendarReminderItem,
	CalendarScope,
	Project,
	Reminder,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { ProjectForm } from "../projects/ProjectForm";
import { ReminderForm, type ReminderSeed } from "../reminders/ReminderForm";
import { SnoozeDialog } from "../reminders/SnoozeDialog";
import { AgendaView } from "./AgendaView";
import {
	addDays,
	addLocalDays,
	addLocalMinutes,
	addMonths,
	formatDate,
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

/** What the Undo toast does. Deleting an event, a reminder or a deadline each undo differently. */
type Undo = { message: string; run: () => Promise<unknown> };

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
	const [undo, setUndo] = useState<Undo | null>(null);
	const [reminderForm, setReminderForm] = useState<{ reminder: Reminder | null; seed: ReminderSeed | null } | null>(null);
	const [projectForm, setProjectForm] = useState<Project | null>(null);
	const [snoozing, setSnoozing] = useState<Reminder | null>(null);
	const [warnings, setWarnings] = useState<string[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	// Which way the range last moved, for the agenda's entrance. Held here
	// because nothing below can tell a step forward from a jump to today.
	const [direction, setDirection] = useState<-1 | 1>(1);

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

	function step(towards: -1 | 1) {
		if (!anchor) return;
		setDirection(towards);
		if (view === "month") setAnchor(addMonths(anchor, towards));
		else if (view === "week") setAnchor(addDays(anchor, 7 * towards));
		else setAnchor(addDays(anchor, AGENDA_DAYS * towards));
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

	async function editEvent(item: CalendarOccurrence) {
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

	function removeEvent(item: CalendarOccurrence) {
		setDetail(null);
		withScope(item, "delete", (scope) => {
			setQuestion(null);
			void run(async () => {
				const result = await window.juno.calendar.remove(item.eventId, {
					scope,
					occurrenceStartLocal: item.occurrenceStartLocal,
				});
				// Only a whole removal can be undone; the other two edit the series.
				if (result.deletedAt) {
					setUndo({
						message: `${result.title} deleted.`,
						run: () => window.juno.calendar.restore(result.id),
					});
				}
			});
		});
	}

	/** Edit whatever kind of item this is: an event, a reminder, or the project a deadline belongs to. */
	async function edit(item: CalendarItem) {
		if (item.kind === "event") return editEvent(item);
		setDetail(null);
		try {
			if (item.kind === "reminder") {
				const reminder = await window.juno.reminders.get(item.reminderId);
				if (!reminder) throw new Error("That reminder no longer exists.");
				setReminderForm({ reminder, seed: null });
			} else {
				const project = await window.juno.projects.get(item.projectId);
				if (!project) throw new Error("That project no longer exists.");
				setProjectForm(project);
			}
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
			refresh();
		}
	}

	/**
	 * Delete whatever kind of item this is. A deadline is the project's own
	 * date, so deleting it clears the date and leaves the project alone.
	 */
	function remove(item: CalendarItem) {
		if (item.kind === "event") return removeEvent(item);
		setDetail(null);
		if (item.kind === "reminder") {
			void run(async () => {
				await window.juno.reminders.remove(item.reminderId);
				setUndo({
					message: `${item.title} deleted.`,
					run: () => window.juno.reminders.restore(item.reminderId),
				});
			});
			return;
		}
		const previous = item.dueOn;
		void run(async () => {
			await window.juno.projects.update(item.projectId, { dueOn: null });
			setUndo({
				message: `Deadline of ${item.projectName} cleared.`,
				run: () => window.juno.projects.update(item.projectId, { dueOn: previous }),
			});
		});
	}

	function complete(item: CalendarReminderItem) {
		setDetail(null);
		void run(async () => {
			const done = await window.juno.reminders.complete(item.reminderId);
			setNotice(
				done.completedAt ? `${item.title} done.` : `${item.title} done. Next one is due ${formatDate(done.dueOn)}.`,
			);
		});
	}

	async function snooze(item: CalendarReminderItem) {
		setDetail(null);
		try {
			const reminder = await window.juno.reminders.get(item.reminderId);
			if (!reminder) throw new Error("That reminder no longer exists.");
			setSnoozing(reminder);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
			refresh();
		}
	}

	async function restore() {
		if (!undo) return;
		const { run: undoIt } = undo;
		setUndo(null);
		await run(undoIt);
	}

	function createReminderAt(date: string) {
		setReminderForm({ reminder: null, seed: { dueOn: date } });
	}

	/** A drag, turned into a wall-clock edit on the event's own zone. */
	function moveEvent(item: CalendarOccurrence, dayDelta: number, minuteDelta: number) {
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

	/** A drag onto another day. Reminders and deadlines are dates, so only whole days apply. */
	function move(item: CalendarItem, dayDelta: number, minuteDelta: number) {
		if (item.kind === "event") return moveEvent(item, dayDelta, minuteDelta);
		const dueOn = addDays(item.dueOn, dayDelta);
		void run(async () => {
			if (item.kind === "reminder") await window.juno.reminders.update(item.reminderId, { dueOn });
			else await window.juno.projects.update(item.projectId, { dueOn });
		}, item.kind === "reminder" ? `${item.title} moved to ${formatDate(dueOn)}.` : `Deadline of ${item.projectName} moved to ${formatDate(dueOn)}.`);
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
	const dismissUndo = useCallback(() => setUndo(null), []);

	const heading =
		!anchor || !from || !to
			? ""
			: view === "month"
				? monthLabel(anchor)
				: view === "week"
					? weekLabel(anchor)
					: `${formatDayShort(from)} to ${formatDayShort(to)} ${to.slice(0, 4)}`;

	if (reminderForm) {
		return (
			<ReminderForm
				reminder={reminderForm.reminder}
				seed={reminderForm.seed}
				backLabel="Calendar"
				onClose={() => setReminderForm(null)}
				onSaved={() => {
					setReminderForm(null);
					refresh();
				}}
			/>
		);
	}

	if (projectForm) {
		return (
			<ProjectForm
				project={projectForm}
				backLabel="Calendar"
				onClose={() => setProjectForm(null)}
				onSaved={() => {
					setProjectForm(null);
					refresh();
				}}
			/>
		);
	}

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
					<Button
						size="dense"
						onClick={() => {
							if (!today) return;
							if (anchor) setDirection(today >= anchor ? 1 : -1);
							setAnchor(today);
						}}
					>
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
					<MenuButton
						items={[
							{
								id: "new-event",
								label: "New event",
								icon: "calendar",
								onSelect: () => anchor && createAt(view === "month" ? (today ?? anchor) : anchor, 9 * 60),
							},
							{
								id: "new-reminder",
								label: "New reminder",
								icon: "reminders",
								onSelect: () => anchor && createReminderAt(view === "month" ? (today ?? anchor) : anchor),
							},
						]}
						ariaLabel="New"
						label="New"
						icon="add"
						size="dense"
					/>
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
						onCreateReminderAt={createReminderAt}
						onOpenDay={(date) => {
							setAnchor(date);
							setView("week");
						}}
						onMove={(item, dayDelta) => move(item, dayDelta, 0)}
						onEdit={(item) => void edit(item)}
						onDelete={(item) => remove(item)}
						onComplete={complete}
						onSnooze={(item) => void snooze(item)}
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
						onComplete={complete}
						onSnooze={(item) => void snooze(item)}
						onStep={step}
					/>
				) : (
					<AgendaView
						direction={direction}
						dates={dates}
						today={today}
						placed={placed}
						onOpen={setDetail}
						onEdit={(item) => void edit(item)}
						onDelete={(item) => remove(item)}
						onComplete={complete}
						onSnooze={(item) => void snooze(item)}
						onStep={step}
					/>
				)}
				</div>

				{detail ? (
					<EventDetail
						item={detail}
						onClose={() => setDetail(null)}
						onEdit={() => void edit(detail)}
						onDelete={() => remove(detail)}
						onComplete={() => {
							if (detail.kind === "reminder") complete(detail);
						}}
						onSnooze={() => {
							if (detail.kind === "reminder") void snooze(detail);
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

			{snoozing ? (
				<SnoozeDialog
					reminder={snoozing}
					onClose={() => setSnoozing(null)}
					onSnoozed={() => {
						setSnoozing(null);
						setNotice("Reminder snoozed.");
						refresh();
					}}
				/>
			) : null}

			{undo ? (
				<Toast message={undo.message} actionLabel="Undo" onAction={() => void restore()} onDismiss={dismissUndo} />
			) : null}

			{undo === null && notice ? <Toast message={notice} onDismiss={dismissNotice} /> : null}
		</div>
	);
}
