import { useState } from "react";
import type { Reminder, ReminderBucket } from "@shared/types";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
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

	return (
		<div className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]">
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
				{reminder.actionUrl && reminder.actionLabel ? (
					<Button
						size="dense"
						disabled={busy}
						onClick={() => void run(() => window.juno.reminders.openAction(reminder.id))}
					>
						<span className="text-[var(--accent)]">{reminder.actionLabel}</span>
					</Button>
				) : null}

				{done ? (
					<Button
						size="dense"
						disabled={busy}
						onClick={() => void run(() => window.juno.reminders.reopen(reminder.id))}
					>
						Reopen
					</Button>
				) : (
					<>
						<Button
							size="dense"
							disabled={busy}
							onClick={() => void run(() => window.juno.reminders.complete(reminder.id))}
						>
							Done
						</Button>
						<Button size="dense" disabled={busy} onClick={() => onSnooze(reminder)}>
							Snooze
						</Button>
					</>
				)}

				<Button size="dense" disabled={busy} onClick={() => onEdit(reminder)}>
					Edit
				</Button>
				<Button size="dense" variant="danger" disabled={busy} onClick={() => void remove()}>
					Delete
				</Button>
			</div>
		</div>
	);
}
