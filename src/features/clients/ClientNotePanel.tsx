import { type FormEvent, useId, useState } from "react";
import type { ClientNote, ClientNoteKind, ClientNotePatch } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";

type ClientNotePanelProps = {
	clientId: string;
	/** Null creates, a note edits. */
	note: ClientNote | null;
	/** Only read when creating: which kind the form opens with. */
	initialKind?: ClientNoteKind;
	onClose: () => void;
	onSaved: () => void;
};

const KIND_OPTIONS: { value: ClientNoteKind; label: string }[] = [
	{ value: "note", label: "Note" },
	{ value: "call", label: "Call" },
	{ value: "meeting", label: "Meeting" },
];

/** An instant, split into the local date and time a pair of inputs can hold. */
function toLocalParts(iso: string | null): { date: string; time: string } {
	const at = iso ? new Date(iso) : new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return {
		date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
		time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
	};
}

/** The local date and time a pair of inputs held, back to a UTC instant. */
function toIso(date: string, time: string): string {
	const local = new Date(`${date}T${time || "00:00"}`);
	return Number.isNaN(local.getTime()) ? new Date().toISOString() : local.toISOString();
}

/**
 * What happened, and when. The one place a call or a meeting gets written down,
 * since nothing else in Juno leaves a trace of either.
 */
export function ClientNotePanel({ clientId, note, initialKind, onClose, onSaved }: ClientNotePanelProps) {
	const formId = useId();
	const initial = toLocalParts(note?.happenedAt ?? null);
	const [title, setTitle] = useState(note?.title ?? "");
	const [kind, setKind] = useState<ClientNoteKind>(note?.kind ?? initialKind ?? "note");
	const [date, setDate] = useState(initial.date);
	const [time, setTime] = useState(initial.time);
	const [body, setBody] = useState(note?.body ?? "");
	const [titleError, setTitleError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const trimmed = title.trim();
		if (trimmed.length === 0) {
			setTitleError("Say what happened.");
			return;
		}

		setTitleError(null);
		setError(null);
		setBusy(true);

		const patch: ClientNotePatch = {
			title: trimmed,
			kind,
			happenedAt: toIso(date, time),
			body: body.trim() || null,
		};

		try {
			if (note) await window.juno.clientNotes.update(note.id, patch);
			else await window.juno.clientNotes.create({ ...patch, clientId, title: trimmed });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={note ? "Edit note" : "Add note"}
			subtitle="What happened, and when"
			onClose={onClose}
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" form={formId} variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
				<Field
					label="What happened"
					required
					value={title}
					onChange={setTitle}
					error={titleError}
					placeholder="Called about the contract"
				/>
				<Select
					label="Kind"
					value={kind}
					onChange={(value) => setKind(value as ClientNoteKind)}
					options={KIND_OPTIONS}
				/>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Date" type="date" value={date} onChange={setDate} tabular />
					<Field label="Time" type="time" value={time} onChange={setTime} tabular />
				</div>
				<Field
					label="Detail"
					multiline
					rows={5}
					value={body}
					onChange={setBody}
					placeholder="Anything worth remembering"
				/>

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not save this note.</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</SidePanel>
	);
}
