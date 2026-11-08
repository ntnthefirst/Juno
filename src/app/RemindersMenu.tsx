import { useCallback, useEffect, useState } from "react";
import type { Reminder, ReminderBucket } from "@shared/types";
import { Checkbox } from "../components/Checkbox";
import { messageOf } from "../lib/errors";
import { BUCKET_LABELS, describeDue, todayIso } from "../features/reminders/format";
import { TitleMenu, TitleMenuHeading } from "./TitleMenu";

type RemindersMenuProps = {
	at: { x: number; y: number };
	onClose: () => void;
	/** The Reminders screen, for the foot of the menu and a click on a row. */
	onOpenScreen: () => void;
};

/** What the bell lists: what is late, what is today and what is close. Later waits for the screen. */
const SHOWN: ReminderBucket[] = ["overdue", "today", "soon"];
const LIMIT = 8;

/**
 * The reminders that need you soon, under the bell, as Recent lists records
 * under its clock. The circle ticks one off where it is; a click on the rest
 * of a row, or the foot of the menu, opens the Reminders screen.
 */
export function RemindersMenu({ at, onClose, onOpenScreen }: RemindersMenuProps) {
	const [rows, setRows] = useState<Reminder[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [today, setToday] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const load = useCallback(() => {
		window.juno.reminders
			.list({ includeDone: false })
			.then((list) => {
				// The clock is impure, so it is read with the list rather than during render.
				setToday(todayIso());
				setRows(list.filter((row) => SHOWN.includes(row.bucket)).slice(0, LIMIT));
				setError(null);
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	async function complete(reminder: Reminder) {
		if (busy) return;
		setBusy(reminder.id);
		try {
			await window.juno.reminders.complete(reminder.id);
			load();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	function openScreen() {
		onClose();
		onOpenScreen();
	}

	return (
		<TitleMenu at={at} label="Reminders" width={340} onClose={onClose} footer={{ label: "Open reminders", onSelect: onOpenScreen }}>
			{error ? (
				<p data-selectable className="px-2.5 py-3 text-dense text-[var(--risk)]">
					{error}
				</p>
			) : rows === null ? (
				<p className="px-2.5 py-3 text-dense text-[var(--ink-muted)]">Loading.</p>
			) : rows.length === 0 ? (
				<p className="px-2.5 py-3 text-dense text-[var(--ink-muted)]">Nothing is due this week.</p>
			) : (
				SHOWN.map((bucket) => {
					const group = rows.filter((row) => row.bucket === bucket);
					if (group.length === 0) return null;
					return (
						<section key={bucket} aria-label={BUCKET_LABELS[bucket]}>
							<TitleMenuHeading>{BUCKET_LABELS[bucket]}</TitleMenuHeading>
							{group.map((reminder) => {
								const meta = [reminder.clientName, reminder.projectName].filter(Boolean).join(" · ");
								return (
									<div
										key={reminder.id}
										className="flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
									>
										<span className="flex h-8 w-6 flex-none items-center justify-center">
											<Checkbox
												shape="round"
												checked={busy === reminder.id}
												disabled={busy !== null}
												onChange={() => void complete(reminder)}
												aria-label={`Mark ${reminder.title} done`}
											/>
										</span>
										<button type="button" onClick={openScreen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
											<span className="min-w-0 flex-1">
												<span className="block truncate text-base text-[var(--ink)]">{reminder.title}</span>
												{meta ? <span className="block truncate text-sm text-[var(--ink-muted)]">{meta}</span> : null}
											</span>
											<span
												className={[
													"tabular flex-none whitespace-nowrap text-dense",
													bucket === "overdue" ? "text-[var(--risk)]" : "text-[var(--ink-muted)]",
												].join(" ")}
											>
												{today ? describeDue(reminder.dueOn, today) : ""}
											</span>
										</button>
									</div>
								);
							})}
						</section>
					);
				})
			)}
		</TitleMenu>
	);
}
