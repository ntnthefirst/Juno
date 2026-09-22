import { useEffect, useState, type FormEvent } from "react";
import type { Reminder } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { addDays, addMonths, todayIso } from "./format";

type SnoozeDialogProps = {
	reminder: Reminder;
	onClose: () => void;
	onSnoozed: () => void;
};

const CHOICES: { label: string; from: (today: string) => string }[] = [
	{ label: "Tomorrow", from: (today) => addDays(today, 1) },
	{ label: "In 3 days", from: (today) => addDays(today, 3) },
	{ label: "Next week", from: (today) => addDays(today, 7) },
	{ label: "Next month", from: (today) => addMonths(today, 1) },
];

export function SnoozeDialog({ reminder, onClose, onSnoozed }: SnoozeDialogProps) {
	const [today, setToday] = useState<string | null>(null);
	const [until, setUntil] = useState("");
	const [dateError, setDateError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

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

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		if (until.length === 0) {
			setDateError("Choose a date to snooze until.");
			return;
		}

		setDateError(null);
		setBusy(true);
		try {
			await window.juno.reminders.snooze(reminder.id, until);
			onSnoozed();
		} catch (cause: unknown) {
			// The service refuses a date that is not in the future, and says so in
			// words worth reading, so it is shown against the field it is about.
			setDateError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<Dialog title="Snooze reminder" width="narrow" onClose={onClose}>
			<form onSubmit={submit} noValidate className="mt-5">
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">{reminder.title}</p>

				<div className="mt-4 flex flex-wrap gap-2">
					{CHOICES.map((choice) => {
						const value = today ? choice.from(today) : "";
						return (
							<Button
								key={choice.label}
								size="dense"
								disabled={today === null}
								aria-pressed={value.length > 0 && value === until}
								onClick={() => {
									setUntil(value);
									setDateError(null);
								}}
							>
								{choice.label}
							</Button>
						);
					})}
				</div>

				<div className="mt-4">
					<Field
						label="Snooze until"
						type="date"
						value={until}
						onChange={(value) => {
							setUntil(value);
							setDateError(null);
						}}
						error={dateError}
						tabular
					/>
				</div>

				<div className="mt-6 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{busy ? "Snoozing" : "Snooze"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
