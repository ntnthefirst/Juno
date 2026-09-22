import { useCallback, useEffect, useState } from "react";
import type { Briefing, Reminder, ReminderSuggestion } from "@shared/types";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { formatDate, plural, todayIso } from "../reminders/format";
import { ReminderForm } from "../reminders/ReminderForm";
import { ReminderRow } from "../reminders/ReminderRow";
import { SnoozeDialog } from "../reminders/SnoozeDialog";
import { SuggestionList } from "../reminders/SuggestionList";
import { BriefingPanel } from "./BriefingPanel";

type Counts = { documents: number; specimens: number; clients: number; projects: number };

type Load<T> =
	| { status: "loading" }
	| { status: "ready"; value: T }
	| { status: "error"; message: string };

export function TodayScreen() {
	const [today, setToday] = useState<string | null>(null);
	const [attention, setAttention] = useState<Load<Reminder[]>>({ status: "loading" });
	const [suggestions, setSuggestions] = useState<ReminderSuggestion[]>([]);
	const [counts, setCounts] = useState<Counts | null>(null);
	const [briefing, setBriefing] = useState<Briefing | null>(null);
	const [briefingError, setBriefingError] = useState<string | null>(null);
	const [editing, setEditing] = useState<Reminder | null>(null);
	const [snoozing, setSnoozing] = useState<Reminder | null>(null);
	const [deleted, setDeleted] = useState<Reminder | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

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

	useEffect(() => {
		let cancelled = false;
		window.juno.reminders
			.list({ actionableOnly: true })
			.then((rows) => {
				if (!cancelled) setAttention({ status: "ready", value: rows });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setAttention({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.reminders
			.suggestions()
			.then((rows) => {
				if (!cancelled) setSuggestions(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setNotice(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			window.juno.documents.list(),
			window.juno.clients.list(),
			window.juno.projects.list(),
		])
			.then(([documents, clients, projects]) => {
				if (cancelled) return;
				setCounts({
					documents: documents.length,
					specimens: documents.filter((document) => document.isSpecimen).length,
					clients: clients.length,
					projects: projects.length,
				});
			})
			.catch((cause: unknown) => {
				if (!cancelled) setNotice(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// The day, worked out by the same service an agent calls, so the screen and
	// the answer an agent gives cannot disagree.
	useEffect(() => {
		let cancelled = false;
		window.juno.briefing
			.today()
			.then((value) => {
				if (!cancelled) setBriefing(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setBriefingError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const refreshAttention = useCallback(() => {
		window.juno.reminders
			.list({ actionableOnly: true })
			.then((rows) => setAttention({ status: "ready", value: rows }))
			.catch((cause: unknown) => setAttention({ status: "error", message: messageOf(cause) }));
	}, []);

	const refreshSuggestions = useCallback(() => {
		window.juno.reminders
			.suggestions()
			.then(setSuggestions)
			.catch((cause: unknown) => setNotice(messageOf(cause)));
	}, []);

	const accepted = useCallback(() => {
		refreshSuggestions();
		refreshAttention();
	}, [refreshSuggestions, refreshAttention]);

	const dismissUndo = useCallback(() => setDeleted(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		setDeleted(null);
		try {
			await window.juno.reminders.restore(id);
			refreshAttention();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	return (
		<div className="h-full overflow-y-auto p-8">
			<div className="max-w-[900px]">
				<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
					Today
				</h1>
				<p className="tabular mt-2 text-[var(--ink-muted)]">
					{today ? `Today is ${formatDate(today)}.` : "Checking the date."}
				</p>

				<div className="mt-8">
					<BriefingPanel
						briefing={briefing}
						error={briefingError}
						sectionKeys={["today", "upcoming", "waiting"]}
					/>
				</div>

				<section className="mt-10">
					<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
						What needs attention
					</h2>
					<div className="mt-4">
						{attention.status === "loading" ? (
							<p className="text-[var(--ink-muted)]">Loading.</p>
						) : attention.status === "error" ? (
							<div className="border-l-2 border-[var(--risk)] pl-4">
								<p className="font-[var(--weight-medium)] text-[var(--risk)]">
									Could not load your reminders.
								</p>
								<p
									data-selectable
									className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
								>
									{attention.message}
								</p>
							</div>
						) : attention.value.length === 0 ? (
							<p className="text-[var(--ink-muted)]">Nothing is due or overdue.</p>
						) : (
							attention.value.map((row) => (
								<ReminderRow
									key={row.id}
									reminder={row}
									onChanged={refreshAttention}
									onEdit={setEditing}
									onSnooze={setSnoozing}
									onDeleted={setDeleted}
									onError={setNotice}
								/>
							))
						)}
					</div>
				</section>

				{suggestions.length > 0 ? (
					<section className="mt-10">
						<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
							Suggestions
						</h2>
						<div className="mt-4">
							<SuggestionList suggestions={suggestions} onAccepted={accepted} />
						</div>
					</section>
				) : null}

				<p className="mt-10 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{counts === null
						? "Counting what is on file."
						: `${plural(counts.clients, "client", "clients")}, ${plural(counts.projects, "project", "projects")}, ${plural(counts.documents, "document", "documents")}, ${counts.specimens} of them ${counts.specimens === 1 ? "a specimen" : "specimens"}.`}
				</p>
			</div>

			{editing ? (
				<ReminderForm
					reminder={editing}
					onClose={() => setEditing(null)}
					onSaved={() => {
						setEditing(null);
						refreshAttention();
					}}
				/>
			) : null}

			{snoozing ? (
				<SnoozeDialog
					reminder={snoozing}
					onClose={() => setSnoozing(null)}
					onSnoozed={() => {
						setSnoozing(null);
						refreshAttention();
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
