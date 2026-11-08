import { listAllClients } from "../../lib/list-all-clients";
import { useEffect, useId, useState, type FormEvent } from "react";
import type {
	CalendarEvent,
	CalendarEventPatch,
	CalendarOccurrence,
	CalendarScope,
	ClientSummary,
	ProjectSummary,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage, type FormStep } from "../../components/FormPage";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import {
	addDays,
	addLocalMinutes,
	dateOf,
	formatTime,
	joinLocal,
	localDateOfInstant,
	localMinutesBetween,
	machineTimeZone,
	timeOf,
} from "./dates";
import { LocationField } from "./LocationField";
import { RecurrenceEditor, type RecurrenceValue } from "./RecurrenceEditor";
import { buildRule, parseRule } from "./recurrence";

type EventFormProps = {
	/** The stored event being edited. A new one is made in its own window (decision 60). */
	event: CalendarEvent;
	/** The occurrence being edited, for scope this and following. */
	occurrence?: CalendarOccurrence | null;
	scope?: CalendarScope;
	/** Where back goes, in words. "Calendar" unless the form was reached from a client or project. */
	backLabel?: string;
	onClose: () => void;
	onSaved: (event: CalendarEvent) => void;
};

type Values = {
	title: string;
	allDay: boolean;
	startDate: string;
	startTime: string;
	endDate: string;
	endTime: string;
	recurrence: RecurrenceValue;
	location: string;
	notes: string;
	clientId: string;
	projectId: string;
};

/** An instant as a wall-clock string on this computer's clock. */
function machineLocalOf(utcIso: string): string {
	return joinLocal(localDateOfInstant(utcIso), formatTime(utcIso));
}

function recurrenceOf(rrule: string | null, startLocal: string): RecurrenceValue {
	if (!rrule) return { mode: "none" };
	const state = parseRule(rrule, startLocal);
	return state ? { mode: "builder", state } : { mode: "custom", rrule };
}

function toValues(event: CalendarEvent, occurrence: CalendarOccurrence | null, scope: CalendarScope): Values {
	// For one occurrence, or this and following, the times come from the
	// occurrence being looked at rather than from the series' first one.
	const timed = scope !== "all" && occurrence ? occurrence : event;
	const allDay = timed.allDay;
	// There is no zone on the form and a save writes the computer's, so an event
	// made in another zone shows its times as they fall here. One occurrence of
	// a series keeps the series' zone, so its times stay as they were written.
	const moveToHere = !allDay && timed.timezone !== machineTimeZone() && !(scope === "this" && event.rrule !== null);
	const startLocal = moveToHere ? machineLocalOf(timed.startUtc) : timed.startLocal;
	const endLocal = moveToHere ? machineLocalOf(timed.endUtc) : timed.endLocal;
	const source = scope === "this" && occurrence ? occurrence : event;
	return {
		title: source.title,
		allDay,
		startDate: dateOf(startLocal),
		startTime: allDay ? "09:00" : timeOf(startLocal),
		// An all-day end is exclusive in storage and inclusive on the form.
		endDate: allDay && endLocal ? addDays(dateOf(endLocal), -1) : dateOf(endLocal),
		endTime: allDay ? "10:00" : timeOf(endLocal),
		recurrence: recurrenceOf(event.rrule, startLocal),
		location: source.location ?? "",
		notes: source.notes ?? "",
		clientId: event.clientId ?? "",
		projectId: event.projectId ?? "",
	};
}

function ruleOf(recurrence: RecurrenceValue, startLocal: string, allDay: boolean): string | null {
	if (recurrence.mode === "none") return null;
	if (recurrence.mode === "custom") return recurrence.rrule.trim() || null;
	return buildRule(recurrence.state, startLocal, allDay);
}

/**
 * Three questions rather than one wall of twenty fields. What it is, when it
 * is, and who it belongs to: the first two are the whole event for most
 * entries, and the third is the one people skip.
 */
const STEPS: FormStep[] = [
	{ label: "What", hint: "What is this appointment, and where does it happen." },
	{ label: "When", hint: "When it runs, and whether it comes back." },
	{ label: "Who", hint: "Who it is for. Everything here is optional." },
];

export function EventForm({ event, occurrence = null, scope = "all", backLabel, onClose, onSaved }: EventFormProps) {
	const [initial] = useState<Values>(() => toValues(event, occurrence, scope));
	const [step, setStep] = useState(0);
	// The submit button sits in the page footer, outside the form element.
	const formId = useId();
	const notesId = useId();
	const [values, setValues] = useState<Values>(initial);
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [titleError, setTitleError] = useState<string | null>(null);
	const [startError, setStartError] = useState<string | null>(null);
	const [endError, setEndError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const singleOccurrence = scope === "this" && event.rrule !== null;

	useEffect(() => {
		let cancelled = false;
		listAllClients()
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

	const clientId = values.clientId;
	useEffect(() => {
		if (clientId.length === 0) return;
		let cancelled = false;
		window.juno.projects
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

	/** Moving the start drags the end along, keeping the length. */
	function setStart(patch: { startDate?: string; startTime?: string }) {
		setValues((current) => {
			const next = { ...current, ...patch };
			if (!current.startDate || !next.startDate) return next;
			if (current.allDay) {
				const length = current.endDate ? localMinutesBetween(current.startDate, current.endDate) : 0;
				return { ...next, endDate: addDays(next.startDate, Math.max(0, Math.round(length / 1440))) };
			}
			if (!current.startTime || !current.endDate || !current.endTime) return next;
			const length = localMinutesBetween(joinLocal(current.startDate, current.startTime), joinLocal(current.endDate, current.endTime));
			const end = addLocalMinutes(joinLocal(next.startDate, next.startTime || "00:00"), Math.max(0, length));
			return { ...next, endDate: dateOf(end), endTime: timeOf(end) };
		});
	}

	const startLocal = values.allDay ? values.startDate : joinLocal(values.startDate || "1970-01-01", values.startTime || "00:00");

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault();
		if (busy) return;

		const title = values.title.trim();
		const startOk = values.startDate.length > 0 && (values.allDay || values.startTime.length > 0);
		const endOk = values.endDate.length > 0 && (values.allDay || values.endTime.length > 0);
		setTitleError(title.length === 0 ? "Enter a title." : null);
		setStartError(startOk ? null : "Choose when it starts.");
		setEndError(endOk ? null : "Choose when it ends.");
		if (title.length === 0 || !startOk || !endOk) return;

		const start = values.allDay ? values.startDate : joinLocal(values.startDate, values.startTime);
		const end = values.allDay ? addDays(values.endDate, 1) : joinLocal(values.endDate, values.endTime);
		const rrule = ruleOf(values.recurrence, start, values.allDay);
		// Compared against the untouched rule built the same way, so a start
		// that moved without the repeat being touched does not count as a change.
		const ruleChanged = rrule !== ruleOf(initial.recurrence, start, values.allDay);

		setError(null);
		setBusy(true);
		try {
			let saved: CalendarEvent;
			if (singleOccurrence) {
				const patch: CalendarEventPatch = {
					title,
					startLocal: start,
					endLocal: end,
					location: values.location.trim() || null,
					notes: values.notes.trim() || null,
				};
				saved = await window.juno.calendar.update(event.id, patch, {
					scope: "this",
					occurrenceStartLocal: occurrence?.occurrenceStartLocal,
				});
			} else {
				const patch: CalendarEventPatch = {
					title,
					allDay: values.allDay,
					startLocal: start,
					endLocal: end,
					// Saved in the computer's zone, whatever zone it was made in: there is
					// no zone to pick, so the times on the form are this machine's.
					timezone: machineTimeZone(),
					location: values.location.trim() || null,
					notes: values.notes.trim() || null,
					clientId: values.clientId || null,
					projectId: values.projectId || null,
					// Sent only when it changed, so the service can keep a COUNT
					// counting down across a split and follow a moved start.
					...(ruleChanged ? { rrule } : {}),
				};
				saved = await window.juno.calendar.update(event.id, patch, {
					scope: event.rrule ? scope : "all",
					...(scope === "following" ? { occurrenceStartLocal: occurrence?.occurrenceStartLocal } : {}),
				});
			}
			onSaved(saved);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	const title = singleOccurrence
		? "Edit this occurrence"
		: scope === "following"
			? "Edit this and following occurrences"
			: event.rrule
				? "Edit all occurrences"
				: "Edit event";

	/** What each step insists on before it will hand over to the next one. */
	function checkStep(index: number): boolean {
		if (index === 0) {
			const ok = values.title.trim().length > 0;
			setTitleError(ok ? null : "Enter a title.");
			return ok;
		}
		if (index === 1) {
			const startOk = values.startDate.length > 0 && (values.allDay || values.startTime.length > 0);
			const endOk = values.endDate.length > 0 && (values.allDay || values.endTime.length > 0);
			setStartError(startOk ? null : "Choose when it starts.");
			setEndError(endOk ? null : "Choose when it ends.");
			return startOk && endOk;
		}
		return true;
	}

	const last = step === STEPS.length - 1;

	return (
		<FormPage
			title={title}
			onBack={onClose}
			backLabel={backLabel ?? "Calendar"}
			steps={STEPS}
			step={step}
			onStep={setStep}
			actions={
				<>
					{step > 0 ? <Button onClick={() => setStep(step - 1)}>Previous</Button> : null}
					{last ? null : (
						<Button variant="quiet" onClick={() => checkStep(step) && setStep(step + 1)}>
							Next
						</Button>
					)}
					<Button type="submit" form={formId} variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate>
				{step === 0 ? (
					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2">
							<Field label="Title" required value={values.title} onChange={(v) => set("title", v)} error={titleError} />
						</div>
						<div className="col-span-2">
							<LocationField value={values.location} onChange={(v) => set("location", v)} />
						</div>
						<div className="col-span-2">
							<label className="flex cursor-default items-center gap-3 text-base">
								<input
									type="checkbox"
									checked={values.allDay}
									disabled={singleOccurrence}
									onChange={(e) => set("allDay", e.target.checked)}
									className="h-4 w-4 accent-[var(--accent)]"
								/>
								All day
							</label>
						</div>
					</div>
				) : step === 1 ? (
					<div className="grid grid-cols-2 gap-4">
						<Field label="Starts on" type="date" required value={values.startDate} onChange={(v) => setStart({ startDate: v })} error={startError} tabular />
						{values.allDay ? (
							<div />
						) : (
							<Field label="At" type="time" required value={values.startTime} onChange={(v) => setStart({ startTime: v })} tabular />
						)}

						<Field label="Ends on" type="date" required value={values.endDate} onChange={(v) => set("endDate", v)} error={endError} tabular />
						{values.allDay ? (
							<div />
						) : (
							<Field label="At" type="time" required value={values.endTime} onChange={(v) => set("endTime", v)} tabular />
						)}

						<div className="col-span-2 border-t border-[var(--line)] pt-4">
							<RecurrenceEditor
								value={values.recurrence}
								onChange={(v) => set("recurrence", v)}
								startLocal={startLocal}
								disabled={singleOccurrence}
							/>
							{singleOccurrence ? (
								<p className="mt-2 text-sm text-[var(--ink-muted)]">
									The repeat rule and client belong to the whole series.
								</p>
							) : null}
						</div>
					</div>
				) : (
					<div className="grid grid-cols-2 gap-4">
						<Select
							label="Client"
							value={values.clientId}
							onChange={(v) => {
								setProjects([]);
								setValues((current) => ({ ...current, clientId: v, projectId: "" }));
							}}
							placeholder="No client"
							disabled={singleOccurrence}
							options={clients.map((c) => ({ value: c.id, label: c.name }))}
						/>
						<Select
							label="Project"
							value={values.projectId}
							onChange={(v) => set("projectId", v)}
							placeholder={values.clientId ? "No project" : "Choose a client first"}
							disabled={singleOccurrence || values.clientId.length === 0}
							options={projects.map((p) => ({ value: p.id, label: p.name }))}
						/>

						<div className="col-span-2">
							<label
								htmlFor={notesId}
								className="mb-1 block text-sm text-[var(--ink-muted)]"
							>
								Notes
							</label>
							<MarkdownEditor id={notesId} value={values.notes} onChange={(v) => set("notes", v)} rows={4} />
							<p className="mt-1 text-sm text-[var(--ink-muted)]">
								Markdown is supported: **bold**, _italic_, a [link](https://example.com), a list.
							</p>
						</div>
					</div>
				)}

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not save this event.</p>
						<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</FormPage>
	);
}
