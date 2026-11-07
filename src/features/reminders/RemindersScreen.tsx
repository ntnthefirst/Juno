import { useCallback, useEffect, useState } from "react";
import type { Reminder, ReminderBucket } from "@shared/types";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { EmptyState } from "../../components/EmptyState";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { blankMenuFor } from "../../lib/blank-menu";
import { openNewRecord, useRecordsChanged } from "../../lib/new-record";
import { BUCKET_LABELS, BUCKET_ORDER, todayIso } from "./format";
import { ReminderForm } from "./ReminderForm";
import { ReminderRow } from "./ReminderRow";
import { SnoozeDialog } from "./SnoozeDialog";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: Reminder[] }
	| { status: "error"; message: string };

export function RemindersScreen() {
	const [includeDone, setIncludeDone] = useState(false);
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [form, setForm] = useState<{ reminder: Reminder } | null>(null);
	const [snoozing, setSnoozing] = useState<Reminder | null>(null);
	const [deleted, setDeleted] = useState<Reminder | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [today, setToday] = useState<string | null>(null);

	// The clock is impure, so it is read here rather than during render.
	useEffect(() => {
		let cancelled = false;
		Promise.resolve(todayIso()).then((value) => {
			if (!cancelled) setToday(value);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const fetchRows = useCallback(
		() => window.juno.reminders.list({ includeDone }),
		[includeDone],
	);

	useEffect(() => {
		let cancelled = false;
		fetchRows()
			.then((rows) => {
				if (!cancelled) setLoad({ status: "ready", rows });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchRows]);

	const refreshList = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [fetchRows]);

	// A new-record window saved a reminder, so the list reads again.
	useRecordsChanged(refreshList);

	const dismissUndo = useCallback(() => setDeleted(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		setDeleted(null);
		try {
			await window.juno.reminders.restore(id);
			refreshList();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	const order: ReminderBucket[] = includeDone ? [...BUCKET_ORDER, "done"] : BUCKET_ORDER;
	const rows = load.status === "ready" ? load.rows : [];

	if (form) {
		return (
			<ReminderForm
				reminder={form.reminder}
				onClose={() => setForm(null)}
				onSaved={() => {
					setForm(null);
					refreshList();
				}}
			/>
		);
	}

	return (
		<div className="h-full overflow-y-auto p-8" onContextMenu={blankMenuFor("reminders")}>
			<div className="w-full">
				<TitleBarSlot side="right">
					<button
						type="button"
						aria-pressed={includeDone}
						onClick={() => setIncludeDone((current) => !current)}
						className="inline-flex h-7 items-center rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
					>
						{includeDone ? "Hide completed" : "Show completed"}
					</button>
				</TitleBarSlot>

				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not load your reminders.
						</p>
						<p
							data-selectable
							className="mt-1 text-sm text-[var(--ink-muted)]"
						>
							{load.message}
						</p>
					</div>
				) : rows.length === 0 ? (
					<EmptyState
						icon="reminders"
						title="All caught up"
						description="Paperwork that is due, invoices that need writing, payments that need making. Nothing is waiting for you right now."
						action={{
							label: "New reminder",
							icon: "add",
							onClick: () => openNewRecord("reminder"),
						}}
					/>
				) : (
					order.map((bucket) => {
						const group = rows.filter((row) => row.bucket === bucket);
						if (group.length === 0) return null;
						return (
							<section key={bucket} className="mt-8 first:mt-0">
								<div className="flex items-baseline gap-2 px-2">
									<h2 className="text-base font-[var(--weight-semibold)]">
										{BUCKET_LABELS[bucket]}
									</h2>
									<span className="tabular text-sm text-[var(--ink-muted)]">
										{group.length}
									</span>
								</div>
								<div className="mt-2">
									{group.map((row) => (
										<ReminderRow
											key={row.id}
											reminder={row}
											today={today}
											onChanged={refreshList}
											onEdit={(reminder) => setForm({ reminder })}
											onSnooze={setSnoozing}
											onDeleted={setDeleted}
											onError={setNotice}
										/>
									))}
								</div>
							</section>
						);
					})
				)}
			</div>

			{snoozing ? (
				<SnoozeDialog
					reminder={snoozing}
					onClose={() => setSnoozing(null)}
					onSnoozed={() => {
						setSnoozing(null);
						refreshList();
					}}
				/>
			) : null}

			{deleted ? (
				<Toast
					message={`${deleted.title} deleted.`}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={dismissUndo}
				/>
			) : null}

			{deleted === null && notice ? <Toast message={notice} onDismiss={dismissNotice} /> : null}
		</div>
	);
}
