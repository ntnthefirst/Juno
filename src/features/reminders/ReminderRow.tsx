import { useState } from "react";
import type { Reminder } from "@shared/types";
import { Checkbox } from "../../components/Checkbox";
import { ActionMenu } from "../../components/ActionMenu";
import { RecordLink } from "../../components/RecordLink";
import { messageOf } from "../../lib/errors";
import { requestOpenClient } from "../../lib/open-client";
import { requestOpen } from "../../lib/open-entity";
import { prefersReducedMotion } from "../../lib/motion";
import { contextMenuFor, type MenuHandlers } from "../../lib/native-menu";
import { describeDue, formatDate } from "./format";

type ReminderRowProps = {
	reminder: Reminder;
	/** Today as `YYYY-MM-DD`, for the due label. Null until the screen has read the clock. */
	today: string | null;
	/** Re-read the list the row sits in, after the service has changed something. */
	onChanged: () => void;
	onEdit: (reminder: Reminder) => void;
	onSnooze: (reminder: Reminder) => void;
	/** The screen owns the undo toast, because this row unmounts on the re-read. */
	onDeleted: (reminder: Reminder) => void;
	onError: (message: string) => void;
	/**
	 * "agenda" is the Overview's row (Agenda Row in the design): a ruled line,
	 * a 24px lead and a trailing label the caller words, with no hover tile.
	 */
	variant?: "agenda";
	/** The trailing label in the agenda variant. The list variant words the due date itself. */
	trailing?: string;
};

/**
 * A circle to tick, the title, the date, and a menu that only shows when the
 * row is under the pointer or has focus. Marking a reminder done is what
 * happens on nearly every one, so it is the one thing drawn at rest and the
 * circle is the whole of it. The rest are in the menu, and on the right-click
 * menu, so the mouse has both routes.
 *
 * The bucket is not drawn here. Every screen that lists reminders groups them
 * under it, so repeating it on each row said the same thing twice.
 */
export function ReminderRow({
	reminder,
	today,
	onChanged,
	onEdit,
	onSnooze,
	onDeleted,
	onError,
	variant,
	trailing,
}: ReminderRowProps) {
	const [busy, setBusy] = useState(false);
	// Set the moment a reminder is ticked, so the row folds away while the write happens.
	// It holds the row as it was read, so the fold lasts until the list has been read
	// again rather than springing back open in the moment between the write and the read.
	const [leftFrom, setLeftFrom] = useState<Reminder | null>(null);
	const leaving = leftFrom === reminder;

	async function run(work: () => Promise<unknown>): Promise<boolean> {
		if (busy) return false;
		setBusy(true);
		try {
			await work();
			onChanged();
			return true;
		} catch (cause: unknown) {
			onError(messageOf(cause));
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (busy) return;
		setBusy(true);
		try {
			const removed = await window.juno.reminders.remove(reminder.id);
			onDeleted(removed);
			onChanged();
		} catch (cause: unknown) {
			onError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const belongsTo = [reminder.clientName, reminder.projectName].filter(Boolean).join(" / ");
	// Each name in the meta line opens its own record.
	const client = reminder.clientId && reminder.clientName ? { id: reminder.clientId, name: reminder.clientName } : null;
	const project =
		reminder.projectId && reminder.projectName ? { id: reminder.projectId, name: reminder.projectName } : null;
	const meta = [belongsTo, reminder.recurrenceLabel].filter(Boolean).join(" · ");
	const done = reminder.bucket === "done";
	const overdue = reminder.bucket === "overdue";
	async function complete() {
		if (busy || leaving) return;
		setLeftFrom(reminder);
		// Long enough for the fold to be seen, and none at all when the system asks for less movement.
		await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : 280));
		if (!(await run(() => window.juno.reminders.complete(reminder.id)))) setLeftFrom(null);
	}
	const toggle = () => (done ? void run(() => window.juno.reminders.reopen(reminder.id)) : void complete());

	// The items are chosen in the main process from the reminder (decision 59).
	// This says what each one does here.
	const handlers: MenuHandlers = {
		complete: toggle,
		reopen: toggle,
		snooze: () => onSnooze(reminder),
		"open-link": () => void run(() => window.juno.reminders.openAction(reminder.id)),
		edit: () => onEdit(reminder),
		// The client is one of the fields of the edit form.
		"move-to-client": () => onEdit(reminder),
		delete: () => void remove(),
		done: () => onChanged(),
		failed: onError,
	};
	const target = { kind: "reminder", id: reminder.id } as const;
	const agenda = variant === "agenda";

	return (
		<div
			className="grid transition-[grid-template-rows,opacity] duration-[var(--duration-slow)] ease-[var(--ease-smooth)]"
			style={{ gridTemplateRows: leaving ? "0fr" : "1fr", opacity: leaving ? 0 : 1 }}
		>
			<div className={leaving ? "min-h-0 overflow-hidden" : "min-h-0"}>
				<div
					onContextMenu={contextMenuFor(target, handlers)}
					className={
						agenda
							? "group relative flex min-h-14 items-center gap-4 border-b border-line py-3"
							: "group flex items-center gap-1 rounded-[var(--radius-lg)] px-1 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
					}
				>
					<span className={agenda ? "flex h-8 w-6 flex-none items-center justify-center" : "flex h-8 w-8 flex-none items-center justify-center"}>
						<Checkbox
							shape="round"
							checked={done || leaving}
							onChange={toggle}
							disabled={busy}
							aria-label={done ? `Reopen ${reminder.title}` : `Mark ${reminder.title} done`}
						/>
					</span>

					<div className={agenda ? "min-w-0 flex-1" : "min-w-0 flex-1 py-2 pl-1"}>
						<button
							type="button"
							onClick={() => onEdit(reminder)}
							className={`block max-w-full truncate rounded-[var(--radius-sm)] text-left text-base transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${done ? "text-[var(--ink-muted)] line-through" : ""}`}
						>
							{reminder.title}
						</button>
						{meta ? (
							<p className="truncate text-sm text-[var(--ink-muted)]">
								{client ? (
									<RecordLink tone="quiet" onOpen={() => requestOpenClient(client.id, client.name)}>
										{client.name}
									</RecordLink>
								) : (
									reminder.clientName
								)}
								{reminder.clientName && reminder.projectName ? " / " : null}
								{project ? (
									<RecordLink tone="quiet" onOpen={() => requestOpen({ kind: "project", ...project })}>
										{project.name}
									</RecordLink>
								) : (
									reminder.projectName
								)}
								{belongsTo && reminder.recurrenceLabel ? " · " : null}
								{reminder.recurrenceLabel}
							</p>
						) : null}
					</div>

					<span
						className={[
							agenda ? "tabular-nums shrink-0 whitespace-nowrap text-base" : "tabular shrink-0 whitespace-nowrap pl-2 text-dense",
							overdue ? "font-[var(--weight-medium)] text-[var(--risk)]" : "text-[var(--ink-muted)]",
						].join(" ")}
					>
						{agenda && trailing !== undefined
							? trailing
							: today
								? describeDue(reminder.dueOn, today)
								: formatDate(reminder.dueOn)}
						{agenda && trailing !== undefined ? null : reminder.dueTime ? `, ${reminder.dueTime}` : null}
					</span>

					<span className={`${agenda ? "absolute right-0 top-1/2 -translate-y-1/2 bg-surface" : ""} flex-none opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100`}>
						<ActionMenu target={target} handlers={handlers} ariaLabel={`More for ${reminder.title}`} size="dense" />
					</span>

				</div>
			</div>
		</div>
	);
}
