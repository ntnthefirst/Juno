import { useState } from "react";
import type { Reminder } from "@shared/types";
import { Icon } from "../../components/Icon";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { prefersReducedMotion } from "../../lib/motion";
import { useContextMenu } from "../../lib/use-context-menu";
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
}: ReminderRowProps) {
	const [busy, setBusy] = useState(false);
	// Set the moment a reminder is ticked, so the row folds away while the write happens.
	const [leaving, setLeaving] = useState(false);
	const menu = useContextMenu();

	async function run(work: () => Promise<unknown>) {
		if (busy) return;
		setBusy(true);
		try {
			await work();
			onChanged();
		} catch (cause: unknown) {
			onError(messageOf(cause));
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
	const meta = [belongsTo, reminder.recurrenceLabel].filter(Boolean).join(" · ");
	const done = reminder.bucket === "done";
	const overdue = reminder.bucket === "overdue";
	async function complete() {
		if (busy || leaving) return;
		setLeaving(true);
		// Long enough for the fold to be seen, and none at all when the system asks for less movement.
		await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : 280));
		await run(() => window.juno.reminders.complete(reminder.id));
		setLeaving(false);
	}
	const toggle = () => (done ? void run(() => window.juno.reminders.reopen(reminder.id)) : void complete());

	const items: MenuItem[] = [
		done
			? {
					id: "reopen",
					label: "Reopen",
					icon: "reminders",
					disabled: busy,
					onSelect: toggle,
				}
			: {
					id: "complete",
					label: "Mark done",
					icon: "check",
					disabled: busy,
					onSelect: toggle,
				},
		...(done
			? []
			: [
					{
						id: "snooze",
						label: "Snooze",
						icon: "today" as const,
						disabled: busy,
						onSelect: () => onSnooze(reminder),
					},
				]),
		...(reminder.actionUrl && reminder.actionLabel
			? [
					{
						id: "action",
						label: reminder.actionLabel,
						icon: "external" as const,
						disabled: busy,
						onSelect: () => void run(() => window.juno.reminders.openAction(reminder.id)),
					},
				]
			: []),
		{
			id: "edit",
			label: "Edit",
			icon: "edit",
			disabled: busy,
			onSelect: () => onEdit(reminder),
		},
		{
			id: "delete",
			label: "Delete",
			icon: "remove",
			danger: true,
			separatorBefore: true,
			disabled: busy,
			onSelect: () => void remove(),
		},
	];

	return (
		<div
			className="grid transition-[grid-template-rows,opacity] duration-[var(--duration-slow)] ease-[var(--ease-smooth)]"
			style={{ gridTemplateRows: leaving ? "0fr" : "1fr", opacity: leaving ? 0 : 1 }}
		>
			<div className={leaving ? "min-h-0 overflow-hidden" : "min-h-0"}>
				<div
					onContextMenu={menu.open}
					className="group flex items-center gap-1 rounded-[var(--radius-lg)] px-1 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
				>
					<button
						type="button"
						onClick={toggle}
						disabled={busy}
						aria-label={done ? `Reopen ${reminder.title}` : `Mark ${reminder.title} done`}
						className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-full)] disabled:pointer-events-none"
					>
						<span
							aria-hidden
							className={[
								"flex h-[18px] w-[18px] items-center justify-center rounded-[var(--radius-full)] border-[1.5px] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
								done || leaving
									? "border-[var(--ok)] bg-[var(--ok)] text-[var(--paper)]"
									: "border-[var(--line-strong)] text-transparent group-hover:border-[var(--accent)] hover:text-[var(--accent)]",
							].join(" ")}
						>
							<Icon name="check" size={11} strokeWidth={3} />
						</span>
					</button>

					<div className="min-w-0 flex-1 py-2 pl-1">
						<p
							className={`truncate text-[length:var(--text-base)] ${done ? "text-[var(--ink-muted)] line-through" : ""}`}
						>
							{reminder.title}
						</p>
						{meta ? (
							<p className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{meta}</p>
						) : null}
					</div>

					<span
						className={[
							"tabular shrink-0 whitespace-nowrap pl-2 text-[length:var(--text-dense)]",
							overdue ? "font-[var(--weight-medium)] text-[var(--risk)]" : "text-[var(--ink-muted)]",
						].join(" ")}
					>
						{today ? describeDue(reminder.dueOn, today) : formatDate(reminder.dueOn)}
					</span>

					<span className="flex-none opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100">
						<MenuButton items={items} ariaLabel={`More for ${reminder.title}`} disabled={busy} />
					</span>

					{menu.at ? (
						<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={reminder.title} />
					) : null}
				</div>
			</div>
		</div>
	);
}
