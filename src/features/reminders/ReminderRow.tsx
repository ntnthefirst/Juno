import { useState } from "react";
import type { Reminder, ReminderBucket } from "@shared/types";
import { Button } from "../../components/Button";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { useContextMenu } from "../../lib/use-context-menu";
import { BUCKET_LABELS, BUCKET_TONES, formatDate } from "./format";

export function BucketBadge({ bucket }: { bucket: ReminderBucket }) {
	return (
		<span
			className={`inline-block shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${BUCKET_TONES[bucket]}`}
		>
			{BUCKET_LABELS[bucket]}
		</span>
	);
}

type ReminderRowProps = {
	reminder: Reminder;
	/** Re-read the list the row sits in, after the service has changed something. */
	onChanged: () => void;
	onEdit: (reminder: Reminder) => void;
	onSnooze: (reminder: Reminder) => void;
	/** The screen owns the undo toast, because this row unmounts on the re-read. */
	onDeleted: (reminder: Reminder) => void;
	onError: (message: string) => void;
};

/**
 * A row is its own hairline and its own space, not a card. See brand/BRAND.md
 * section 7.
 *
 * One act is a button and the rest are a menu. Five buttons on every row read
 * as five equally likely things to do, when marking a reminder done is what
 * happens on nearly all of them and the other four are occasional. The same
 * four are on the right-click menu, so the mouse has both routes.
 */
export function ReminderRow({
	reminder,
	onChanged,
	onEdit,
	onSnooze,
	onDeleted,
	onError,
}: ReminderRowProps) {
	const [busy, setBusy] = useState(false);
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

	const items: MenuItem[] = [
		done
			? {
					id: "reopen",
					label: "Reopen",
					icon: "reminders",
					disabled: busy,
					onSelect: () => void run(() => window.juno.reminders.reopen(reminder.id)),
				}
			: {
					id: "complete",
					label: "Mark done",
					icon: "check",
					disabled: busy,
					onSelect: () => void run(() => window.juno.reminders.complete(reminder.id)),
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
			onContextMenu={menu.open}
			className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
		>
			<BucketBadge bucket={reminder.bucket} />

			<div className="min-w-0 flex-1">
				<p className="truncate text-[length:var(--text-dense)]">{reminder.title}</p>
				{meta ? (
					<p className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{meta}</p>
				) : null}
			</div>

			<span className="tabular shrink-0 whitespace-nowrap text-[length:var(--text-dense)] text-[var(--ink-muted)]">
				{formatDate(reminder.dueOn)}
			</span>

			<div className="flex shrink-0 items-center gap-1">
				{done ? (
					<Button
						size="dense"
						disabled={busy}
						onClick={() => void run(() => window.juno.reminders.reopen(reminder.id))}
					>
						Reopen
					</Button>
				) : (
					<Button
						size="dense"
						disabled={busy}
						onClick={() => void run(() => window.juno.reminders.complete(reminder.id))}
					>
						Done
					</Button>
				)}

				<MenuButton
					items={items}
					ariaLabel={`More for ${reminder.title}`}
					disabled={busy}
				/>
			</div>

			{menu.at ? (
				<ContextMenu
					at={menu.at}
					items={items}
					onClose={menu.close}
					ariaLabel={reminder.title}
				/>
			) : null}
		</div>
	);
}
