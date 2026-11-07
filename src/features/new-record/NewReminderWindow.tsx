import { useState } from "react";
import type { NewRecordPrefill, RecurrencePattern, ReminderInput } from "@shared/types";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { todayIso } from "../calendar/dates";
import { FieldRow } from "./FieldRow";
import { RecordWindow } from "./RecordWindow";
import { usePickLists } from "./use-pick-lists";

type NewReminderWindowProps = {
	prefill: NewRecordPrefill;
};

/** Counted in ones. A longer interval is a reason to edit the reminder afterwards. */
const REPEATS: { value: RecurrencePattern; label: string }[] = [
	{ value: "once", label: "Once" },
	{ value: "days", label: "Every day" },
	{ value: "weeks", label: "Every week" },
	{ value: "months", label: "Every month" },
	{ value: "years", label: "Every year" },
	{ value: "quarter_end", label: "End of every quarter" },
];

/** The picker holds clients and projects in one list, told apart by a prefix on the value. */
const CLIENT = "client:";
const PROJECT = "project:";

/** New reminder (frame 90:9426). */
export function NewReminderWindow({ prefill }: NewReminderWindowProps) {
	const lists = usePickLists();
	const [title, setTitle] = useState("");
	const [dueOn, setDueOn] = useState(() => prefill.date ?? todayIso());
	const [pattern, setPattern] = useState<RecurrencePattern>("once");
	const [owner, setOwner] = useState(
		prefill.projectId ? `${PROJECT}${prefill.projectId}` : prefill.clientId ? `${CLIENT}${prefill.clientId}` : "",
	);
	const [notes, setNotes] = useState("");
	const [titleError, setTitleError] = useState<string | null>(null);
	const [dueError, setDueError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const options = [
		...lists.clients.map((client) => ({ value: `${CLIENT}${client.id}`, label: client.name })),
		...lists.projects.map((project) => ({
			value: `${PROJECT}${project.id}`,
			label: project.clientName ? `${project.clientName}, ${project.name}` : project.name,
		})),
	];

	async function save() {
		const trimmed = title.trim();
		setTitleError(trimmed.length === 0 ? "Enter what to be reminded of." : null);
		setDueError(dueOn.length === 0 ? "Choose a date." : null);
		if (trimmed.length === 0 || dueOn.length === 0) return;

		setError(null);
		setBusy(true);

		// A project carries its client, so picking one files the reminder under both.
		const project = owner.startsWith(PROJECT)
			? lists.projects.find((candidate) => candidate.id === owner.slice(PROJECT.length))
			: undefined;
		const clientId = owner.startsWith(CLIENT) ? owner.slice(CLIENT.length) : (project?.clientId ?? null);

		// dueOn stays a YYYY-MM-DD string. A Date round trip would move it by a zone offset.
		const input: ReminderInput = {
			title: trimmed,
			dueOn,
			notes: notes.trim() || null,
			pattern,
			interval: 1,
			leadDays: 0,
			category: "paperwork",
			clientId,
			projectId: project?.id ?? null,
		};
		try {
			await window.juno.reminders.create(input);
			await window.juno.window.closeNewRecord(true);
		} catch (cause: unknown) {
			setError(`Could not save this reminder. ${messageOf(cause)}`);
			setBusy(false);
		}
	}

	return (
		<RecordWindow
			title="New reminder"
			saveLabel="Save reminder"
			busy={busy}
			error={error ?? lists.error}
			onSubmit={() => void save()}
		>
			<Field label="What" required value={title} onChange={setTitle} error={titleError} />
			<FieldRow columns="1fr 1fr">
				<Field label="Date" type="date" required value={dueOn} onChange={setDueOn} error={dueError} tabular />
				<Select
					label="Repeats"
					value={pattern}
					onChange={(value) => setPattern(value as RecurrencePattern)}
					options={REPEATS}
				/>
			</FieldRow>
			<Select label="Client or project" value={owner} onChange={setOwner} placeholder="Neither" options={options} />
			<Field label="Notes" multiline rows={2} value={notes} onChange={setNotes} />
		</RecordWindow>
	);
}
