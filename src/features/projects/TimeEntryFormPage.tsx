import { type FormEvent, useId, useState } from "react";
import type { TimeEntry } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { messageOf } from "../../lib/errors";
import { localDateOfInstant, todayIso } from "../calendar/dates";

type TimeEntryFormPageProps = {
	projectId: string;
	/** Null adds time that was already spent, an entry edits it. */
	entry: TimeEntry | null;
	backLabel: string;
	onClose: () => void;
	onSaved: () => void;
};

/**
 * The same instant moved to another calendar day, keeping the time of day it
 * had. A new entry starts at nine, which is only a place to hang the day on:
 * nobody asked for a time of day, and the duration is the figure that counts.
 */
function onDay(date: string, base: string | null): string {
	const source = base ? new Date(base) : null;
	const hours = source ? source.getHours() : 9;
	const minutes = source ? source.getMinutes() : 0;
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, hours, minutes).toISOString();
}

/** Hours and minutes as typed: "1" and "30". Both may be empty, which is zero. */
function toMinutes(hours: string, minutes: string): number | null {
	const h = hours.trim() === "" ? 0 : Number(hours);
	const m = minutes.trim() === "" ? 0 : Number(minutes);
	if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return null;
	return h * 60 + m;
}

/**
 * A time entry on a project, as a page: when, how long and what it was for.
 * While a timer is still running only its note can change, because its end is
 * not known yet.
 */
export function TimeEntryFormPage({ projectId, entry, backLabel, onClose, onSaved }: TimeEntryFormPageProps) {
	const formId = useId();
	const running = entry !== null && entry.endedAt === null;
	const minutes = entry?.durationMinutes ?? 0;
	const [date, setDate] = useState(entry ? localDateOfInstant(entry.startedAt) : todayIso());
	const [hours, setHours] = useState(entry && !running ? String(Math.floor(minutes / 60)) : "");
	const [mins, setMins] = useState(entry && !running ? String(minutes % 60) : "");
	const [note, setNote] = useState(entry?.note ?? "");
	const [error, setError] = useState<string | null>(null);
	const [durationError, setDurationError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const total = running ? 1 : toMinutes(hours, mins);
		if (total === null || total < 1) {
			setDurationError("Enter at least one minute, with minutes from 0 to 59.");
			return;
		}
		setDurationError(null);
		setError(null);
		setBusy(true);

		try {
			if (entry) {
				await window.juno.time.update(entry.id, {
					note: note.trim() ? note : null,
					...(running
						? {}
						: {
								durationMinutes: total,
								...(date !== localDateOfInstant(entry.startedAt)
									? { startedAt: onDay(date, entry.startedAt) }
									: {}),
							}),
				});
			} else {
				await window.juno.time.create({
					projectId,
					durationMinutes: total,
					startedAt: onDay(date, null),
					note: note.trim() ? note : null,
				});
			}
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<FormPage
			title={entry ? "Edit time entry" : "Add time entry"}
			onBack={onClose}
			backLabel={backLabel}
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" form={formId} variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate>
				<div className="grid grid-cols-2 gap-4">
					<div className="col-span-2">
						<Field label="What was done" value={note} onChange={setNote} placeholder="Assembly" />
					</div>
					<div className="col-span-2">
						<Field label="Day" type="date" value={date} onChange={setDate} disabled={running} tabular />
					</div>
					<Field
						label="Hours"
						type="number"
						inputMode="decimal"
						value={hours}
						onChange={setHours}
						error={durationError}
						disabled={running}
						tabular
					/>
					<Field
						label="Minutes"
						type="number"
						inputMode="decimal"
						value={mins}
						onChange={setMins}
						disabled={running}
						tabular
					/>
				</div>
				{running ? (
					<p className="mt-3 text-sm text-[var(--ink-muted)]">
						This timer is still running. Stop it to set its time.
					</p>
				) : null}
				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not save this entry.</p>
						<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</FormPage>
	);
}
