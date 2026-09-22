import { useCallback, useEffect, useState } from "react";
import type { Reminder, ReminderBucket } from "@shared/types";
import { Button } from "../../components/Button";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { BUCKET_LABELS, BUCKET_ORDER, plural } from "./format";
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
	const [form, setForm] = useState<{ reminder: Reminder | null } | null>(null);
	const [snoozing, setSnoozing] = useState<Reminder | null>(null);
	const [deleted, setDeleted] = useState<Reminder | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

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
		<div className="h-full overflow-y-auto p-8">
			<div className="mx-auto w-full max-w-[var(--content-width)]">
				<div className="mb-6 flex items-center justify-between gap-4">
					<div className="flex items-baseline gap-3">
						<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
							Reminders
						</h1>
						{load.status === "ready" ? (
							<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{plural(rows.length, "reminder", "reminders")}
							</span>
						) : null}
					</div>

					<div className="flex items-center gap-2">
						<Button
							aria-pressed={includeDone}
							onClick={() => setIncludeDone((current) => !current)}
						>
							{includeDone ? "Hide completed" : "Show completed"}
						</Button>
						<Button variant="primary" onClick={() => setForm({ reminder: null })}>
							New reminder
						</Button>
					</div>
				</div>

				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not load your reminders.
						</p>
						<p
							data-selectable
							className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
						>
							{load.message}
						</p>
					</div>
				) : rows.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No reminders yet.</p>
				) : (
					order.map((bucket) => {
						const group = rows.filter((row) => row.bucket === bucket);
						if (group.length === 0) return null;
						return (
							<section key={bucket} className="mt-10 first:mt-0">
								<div className="flex items-baseline gap-3 border-b border-[var(--line)] pb-2">
									<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">
										{BUCKET_LABELS[bucket]}
									</h2>
									<span className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{group.length}
									</span>
								</div>
								<div className="mt-4">
									{group.map((row) => (
										<ReminderRow
											key={row.id}
											reminder={row}
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
