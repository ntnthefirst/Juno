import { useEffect, useState, type FormEvent } from "react";
import type {
	ClientSummary,
	ProjectSummary,
	Reminder,
	ReminderCategory,
	ReminderInput,
	RecurrencePattern,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { CATEGORIES, PATTERNS, describeRecurrence, takesInterval } from "./format";

type ReminderFormProps = {
	/** Null creates, a reminder edits. */
	reminder: Reminder | null;
	onClose: () => void;
	onSaved: () => void;
};

type Values = {
	title: string;
	notes: string;
	dueOn: string;
	category: ReminderCategory;
	pattern: RecurrencePattern;
	interval: string;
	leadDays: string;
	clientId: string;
	projectId: string;
};

function toValues(reminder: Reminder | null): Values {
	return {
		title: reminder?.title ?? "",
		notes: reminder?.notes ?? "",
		dueOn: reminder?.dueOn ?? "",
		category: reminder?.category ?? "paperwork",
		pattern: reminder?.pattern ?? "once",
		interval: String(reminder?.interval ?? 1),
		leadDays: String(reminder?.leadDays ?? 0),
		clientId: reminder?.clientId ?? "",
		projectId: reminder?.projectId ?? "",
	};
}

function parseCount(raw: string): number | null {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	return Number.parseInt(trimmed, 10);
}

export function ReminderForm({ reminder, onClose, onSaved }: ReminderFormProps) {
	const [values, setValues] = useState<Values>(() => toValues(reminder));
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [titleError, setTitleError] = useState<string | null>(null);
	const [dueError, setDueError] = useState<string | null>(null);
	const [intervalError, setIntervalError] = useState<string | null>(null);
	const [leadError, setLeadError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.bureau.clients
			.list()
			.then((rows) => {
				if (!cancelled) setClients(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(`Could not load your clients. ${messageOf(cause)}`);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Only the chosen client's projects are offered, so a reminder cannot hang off
	// a project belonging to someone else.
	const clientId = values.clientId;
	useEffect(() => {
		if (clientId.length === 0) return;
		let cancelled = false;
		window.bureau.projects
			.list({ clientId })
			.then((rows) => {
				if (!cancelled) setProjects(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(`Could not load that client's projects. ${messageOf(cause)}`);
			});
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	function set<K extends keyof Values>(key: K, value: Values[K]) {
		setValues((current) => ({ ...current, [key]: value }));
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const title = values.title.trim();
		const counted = takesInterval(values.pattern);
		const interval = counted ? parseCount(values.interval) : 1;
		const leadDays = parseCount(values.leadDays);

		setTitleError(title.length === 0 ? "Enter a title." : null);
		setDueError(values.dueOn.length === 0 ? "Choose a due date." : null);
		setIntervalError(interval === null || interval < 1 ? "Enter a whole number, 1 or more." : null);
		setLeadError(leadDays === null ? "Enter a whole number of days." : null);
		if (
			title.length === 0 ||
			values.dueOn.length === 0 ||
			interval === null ||
			interval < 1 ||
			leadDays === null
		) {
			return;
		}

		setError(null);
		setBusy(true);

		// dueOn stays a YYYY-MM-DD string. A Date round trip shifts it by a timezone
		// offset, which moves the due date to the day before.
		const input: ReminderInput = {
			title,
			dueOn: values.dueOn,
			notes: values.notes.trim().length > 0 ? values.notes.trim() : null,
			pattern: values.pattern,
			interval,
			leadDays,
			category: values.category,
			clientId: values.clientId.length > 0 ? values.clientId : null,
			projectId: values.projectId.length > 0 ? values.projectId : null,
		};

		try {
			if (reminder) await window.bureau.reminders.update(reminder.id, input);
			else await window.bureau.reminders.create(input);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	const counted = takesInterval(values.pattern);
	const intervalNumber = parseCount(values.interval) ?? 1;

	return (
		<Dialog title={reminder ? "Edit reminder" : "New reminder"} onClose={onClose}>
			<form onSubmit={submit} noValidate className="mt-5">
				<div className="grid grid-cols-2 gap-4">
					<div className="col-span-2">
						<Field
							label="Title"
							required
							value={values.title}
							onChange={(value) => set("title", value)}
							error={titleError}
						/>
					</div>

					<Field
						label="Due on"
						type="date"
						required
						value={values.dueOn}
						onChange={(value) => set("dueOn", value)}
						error={dueError}
						tabular
					/>
					<Select
						label="Category"
						value={values.category}
						onChange={(value) => set("category", value as ReminderCategory)}
						options={CATEGORIES}
					/>

					<Select
						label="Repeats"
						value={values.pattern}
						onChange={(value) => set("pattern", value as RecurrencePattern)}
						options={PATTERNS}
					/>
					{counted ? (
						<Field
							label="Every"
							value={values.interval}
							onChange={(value) => set("interval", value)}
							error={intervalError}
							inputMode="decimal"
							placeholder="1"
							tabular
						/>
					) : (
						<div />
					)}

					<div className="col-span-2">
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{describeRecurrence(values.pattern, intervalNumber)}
						</p>
					</div>

					<Field
						label="Lead days"
						value={values.leadDays}
						onChange={(value) => set("leadDays", value)}
						error={leadError}
						inputMode="decimal"
						placeholder="0"
						tabular
					/>
					<div />

					<Select
						label="Client"
						value={values.clientId}
						onChange={(value) => {
							// The old project belongs to the old client, so it cannot survive.
							setProjects([]);
							setValues((current) => ({ ...current, clientId: value, projectId: "" }));
						}}
						placeholder="No client"
						options={clients.map((client) => ({ value: client.id, label: client.name }))}
					/>
					<Select
						label="Project"
						value={values.projectId}
						onChange={(value) => set("projectId", value)}
						placeholder={values.clientId.length > 0 ? "No project" : "Choose a client first"}
						disabled={values.clientId.length === 0}
						options={projects.map((project) => ({ value: project.id, label: project.name }))}
					/>

					<div className="col-span-2">
						<Field
							label="Notes"
							multiline
							rows={3}
							value={values.notes}
							onChange={(value) => set("notes", value)}
						/>
					</div>
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this reminder.
						</p>
						<p
							data-selectable
							className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
						>
							{error}
						</p>
					</div>
				) : null}

				<div className="mt-6 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
