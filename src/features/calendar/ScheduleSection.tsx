import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { addDays, addLocalMinutes, formatDate, formatTime, joinLocal, todayIso } from "./dates";
import { scheduleRows, type ScheduleRow } from "./schedule-rows";
import type { ScheduleForm } from "./schedule-form";

type ScheduleSectionProps = {
	/** One of these. A project's list is its own; a client's list is everything under it. */
	clientId?: string;
	projectId?: string;
	/** Shown beside each row on a client, where the project is the useful part. */
	showProject?: boolean;
	/** Hands a form up to the screen, which draws it as a page. */
	onOpenForm: (form: ScheduleForm) => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: ScheduleRow[] }
	| { status: "error"; message: string };

type Undo = { message: string; run: () => Promise<unknown> };

const SHOWN = 8;
/** Far enough back to catch a reminder that is overdue, short of the 400 days a range allows. */
const LOOK_BACK_DAYS = 60;
const LOOK_AHEAD_DAYS = 330;

/**
 * The dates and reminders that belong to a client or a project, with the
 * actions the calendar has: add, edit, mark done and delete. It is the same
 * data the calendar shows, filtered by the id, so something made here appears
 * there and the other way round.
 */
export function ScheduleSection({ clientId, projectId, showProject = false, onOpenForm }: ScheduleSectionProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [version, setVersion] = useState(0);
	const [all, setAll] = useState(false);
	const [undo, setUndo] = useState<Undo | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(() => setVersion((v) => v + 1), []);

	useEffect(() => {
		let cancelled = false;
		const today = todayIso();
		window.juno.calendar
			.list({
				from: addDays(today, -LOOK_BACK_DAYS),
				to: addDays(today, LOOK_AHEAD_DAYS),
				includeReminders: true,
				...(projectId ? { projectId } : clientId ? { clientId } : {}),
			})
			.then((items) => {
				if (!cancelled) setLoad({ status: "ready", rows: scheduleRows(items, today) });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [clientId, projectId, version]);

	async function run(work: () => Promise<unknown>, done?: string) {
		try {
			await work();
			if (done) setNotice(done);
			refresh();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function addEvent() {
		const startLocal = joinLocal(todayIso(), "09:00");
		onOpenForm({
			kind: "event",
			event: null,
			seed: {
				startLocal,
				endLocal: addLocalMinutes(startLocal, 60),
				allDay: false,
				...(clientId ? { clientId } : {}),
				...(projectId ? { projectId } : {}),
			},
		});
	}

	function addReminder() {
		onOpenForm({
			kind: "reminder",
			reminder: null,
			seed: { ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) },
		});
	}

	async function edit(row: ScheduleRow) {
		try {
			if (row.kind === "event") {
				const event = await window.juno.calendar.get(row.item.eventId);
				if (!event) throw new Error("That event no longer exists.");
				onOpenForm({
					kind: "event",
					event,
					seed: { startLocal: event.startLocal, endLocal: event.endLocal, allDay: event.allDay },
				});
			} else {
				const reminder = await window.juno.reminders.get(row.item.reminderId);
				if (!reminder) throw new Error("That reminder no longer exists.");
				onOpenForm({ kind: "reminder", reminder, seed: {} });
			}
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
			refresh();
		}
	}

	function remove(row: ScheduleRow) {
		void run(async () => {
			if (row.kind === "event") {
				const removed = await window.juno.calendar.remove(row.item.eventId, { scope: "all" });
				setUndo({ message: `${row.item.title} deleted.`, run: () => window.juno.calendar.restore(removed.id) });
			} else {
				await window.juno.reminders.remove(row.item.reminderId);
				setUndo({
					message: `${row.item.title} deleted.`,
					run: () => window.juno.reminders.restore(row.item.reminderId),
				});
			}
		});
	}

	function complete(row: ScheduleRow) {
		if (row.kind !== "reminder") return;
		void run(async () => {
			const done = await window.juno.reminders.complete(row.item.reminderId);
			setNotice(
				done.completedAt
					? `${row.item.title} done.`
					: `${row.item.title} done. Next one is due ${formatDate(done.dueOn)}.`,
			);
		});
	}

	async function restore() {
		if (!undo) return;
		const { run: undoIt } = undo;
		setUndo(null);
		await run(undoIt);
	}

	const dismissUndo = useCallback(() => setUndo(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	const rows = useMemo(() => (load.status === "ready" ? load.rows : []), [load]);
	const shown = useMemo(() => (all ? rows : rows.slice(0, SHOWN)), [all, rows]);

	return (
		<section>
			<div className="mb-2 flex items-center justify-between gap-4">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)]">Dates and reminders</h2>
				<div className="flex items-center gap-1">
					<Button size="dense" onClick={addEvent}>
						<Icon name="calendar" />
						Add date
					</Button>
					<Button size="dense" onClick={addReminder}>
						<Icon name="reminders" />
						Add reminder
					</Button>
				</div>
			</div>

			{load.status === "error" ? (
				<p className="border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{load.message}
				</p>
			) : load.status === "loading" ? (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Loading.</p>
			) : rows.length === 0 ? (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Nothing planned. Add a date for a meeting or a delivery, or a reminder for something to do.
				</p>
			) : (
				<ul className="flex flex-col">
					{shown.map((row) => (
						<ScheduleRowItem
							key={row.key}
							row={row}
							showProject={showProject}
							onEdit={() => void edit(row)}
							onRemove={() => remove(row)}
							onComplete={() => complete(row)}
						/>
					))}
				</ul>
			)}

			{rows.length > SHOWN ? (
				<div className="mt-2">
					<Button size="dense" onClick={() => setAll((v) => !v)}>
						{all ? "Show fewer" : `Show all ${rows.length}`}
					</Button>
				</div>
			) : null}

			{undo ? (
				<Toast message={undo.message} actionLabel="Undo" onAction={() => void restore()} onDismiss={dismissUndo} />
			) : null}
			{undo === null && notice ? <Toast message={notice} onDismiss={dismissNotice} /> : null}
		</section>
	);
}

type ScheduleRowItemProps = {
	row: ScheduleRow;
	showProject: boolean;
	onEdit: () => void;
	onRemove: () => void;
	onComplete: () => void;
};

function repeatLabel(row: ScheduleRow): string | null {
	if (row.kind === "event") return row.item.isRecurring ? row.item.recurrenceLabel : null;
	return row.item.recurrenceLabel !== "Once" ? row.item.recurrenceLabel : null;
}

function ScheduleRowItem({ row, showProject, onEdit, onRemove, onComplete }: ScheduleRowItemProps) {
	const { item } = row;
	const overdue = row.kind === "reminder" && row.item.bucket === "overdue";
	const when =
		row.kind === "event" && !row.item.allDay
			? `${formatDate(row.date)} ${formatTime(row.item.startUtc)}`
			: formatDate(row.date);
	const detail = [
		showProject ? item.projectName : null,
		repeatLabel(row),
		row.kind === "event" ? row.item.location : null,
	]
		.filter(Boolean)
		.join(" / ");

	return (
		<li
			className="group flex items-center gap-3 border-b border-[var(--line)] px-2"
			style={{ height: "var(--row-height)" }}
		>
			<span
				aria-hidden
				className={`h-2 w-2 flex-none rounded-[var(--radius-full)] ${
					row.kind === "event" ? "bg-[var(--accent)]" : overdue ? "bg-[var(--risk)]" : "bg-[var(--warn)]"
				}`}
			/>
			<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
				{item.title}
				{detail ? <span className="ml-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{detail}</span> : null}
			</span>
			<span
				className={`tabular flex-none text-[length:var(--text-sm)] ${overdue ? "text-[var(--risk)]" : "text-[var(--ink-muted)]"}`}
			>
				{overdue ? `Overdue, ${when}` : when}
			</span>
			<span className="flex flex-none items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
				{row.kind === "reminder" ? (
					<IconButton label={`Mark ${item.title} done`} icon="check" onClick={onComplete} />
				) : null}
				<IconButton label={`Edit ${item.title}`} icon="edit" onClick={onEdit} />
				<IconButton label={`Delete ${item.title}`} icon="remove" onClick={onRemove} />
			</span>
		</li>
	);
}

type IconButtonProps = {
	label: string;
	icon: "check" | "edit" | "remove";
	onClick: () => void;
};

function IconButton({ label, icon, onClick }: IconButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
		>
			<Icon name={icon} size={16} />
		</button>
	);
}
