import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
	CalendarEvent,
	CalendarEventInput,
	CalendarEventPatch,
	CalendarOccurrence,
	CalendarScope,
	ClientSummary,
	ProjectSummary,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { addDays, addLocalMinutes, dateOf, joinLocal, localMinutesBetween, machineTimeZone, timeOf } from "./dates";
import { RecurrenceEditor, type RecurrenceValue } from "./RecurrenceEditor";
import { buildRule, parseRule } from "./recurrence";

export type EventSeed = {
	startLocal: string;
	endLocal: string;
	allDay: boolean;
};

type EventFormProps = {
	/** The stored event when editing, null when creating. */
	event: CalendarEvent | null;
	/** The occurrence being edited, for scope this and following. */
	occurrence?: CalendarOccurrence | null;
	scope?: CalendarScope;
	/** Where a click on the grid landed, when creating. */
	seed?: EventSeed | null;
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
	timezone: string;
	recurrence: RecurrenceValue;
	location: string;
	notes: string;
	clientId: string;
	projectId: string;
};

function recurrenceOf(rrule: string | null, startLocal: string): RecurrenceValue {
	if (!rrule) return { mode: "none" };
	const state = parseRule(rrule, startLocal);
	return state ? { mode: "builder", state } : { mode: "custom", rrule };
}

function toValues(event: CalendarEvent | null, occurrence: CalendarOccurrence | null, scope: CalendarScope, seed: EventSeed | null): Values {
	// For one occurrence, or this and following, the times come from the
	// occurrence being looked at rather than from the series' first one.
	const timed = scope !== "all" && occurrence ? occurrence : event;
	const startLocal = timed?.startLocal ?? seed?.startLocal ?? "";
	const endLocal = timed?.endLocal ?? seed?.endLocal ?? "";
	const allDay = timed?.allDay ?? seed?.allDay ?? false;
	const source = scope === "this" && occurrence ? occurrence : event;
	return {
		title: source?.title ?? "",
		allDay,
		startDate: dateOf(startLocal),
		startTime: allDay ? "09:00" : timeOf(startLocal),
		// An all-day end is exclusive in storage and inclusive on the form.
		endDate: allDay && endLocal ? addDays(dateOf(endLocal), -1) : dateOf(endLocal),
		endTime: allDay ? "10:00" : timeOf(endLocal),
		timezone: event?.timezone ?? machineTimeZone(),
		recurrence: recurrenceOf(event?.rrule ?? null, startLocal),
		location: source?.location ?? "",
		notes: source?.notes ?? "",
		clientId: event?.clientId ?? "",
		projectId: event?.projectId ?? "",
	};
}

function ruleOf(recurrence: RecurrenceValue, startLocal: string, allDay: boolean): string | null {
	if (recurrence.mode === "none") return null;
	if (recurrence.mode === "custom") return recurrence.rrule.trim() || null;
	return buildRule(recurrence.state, startLocal, allDay);
}

export function EventForm({ event, occurrence = null, scope = "all", seed = null, onClose, onSaved }: EventFormProps) {
	const [initial] = useState<Values>(() => toValues(event, occurrence, scope, seed));
	const [values, setValues] = useState<Values>(initial);
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [titleError, setTitleError] = useState<string | null>(null);
	const [startError, setStartError] = useState<string | null>(null);
	const [endError, setEndError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const singleOccurrence = scope === "this" && event?.rrule !== null && event !== null;

	const zones = useMemo(() => {
		const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
		if (!list.includes(values.timezone)) list.unshift(values.timezone);
		return list.map((zone) => ({ value: zone, label: zone }));
	}, [values.timezone]);

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
			if (!event) {
				const input: CalendarEventInput = {
					title,
					allDay: values.allDay,
					startLocal: start,
					endLocal: end,
					timezone: values.timezone,
					rrule,
					location: values.location.trim() || null,
					notes: values.notes.trim() || null,
					clientId: values.clientId || null,
					projectId: values.projectId || null,
				};
				saved = await window.bureau.calendar.create(input);
			} else if (singleOccurrence) {
				const patch: CalendarEventPatch = {
					title,
					startLocal: start,
					endLocal: end,
					location: values.location.trim() || null,
					notes: values.notes.trim() || null,
				};
				saved = await window.bureau.calendar.update(event.id, patch, {
					scope: "this",
					occurrenceStartLocal: occurrence?.occurrenceStartLocal,
				});
			} else {
				const patch: CalendarEventPatch = {
					title,
					allDay: values.allDay,
					startLocal: start,
					endLocal: end,
					timezone: values.timezone,
					location: values.location.trim() || null,
					notes: values.notes.trim() || null,
					clientId: values.clientId || null,
					projectId: values.projectId || null,
					// Sent only when it changed, so the service can keep a COUNT
					// counting down across a split and follow a moved start.
					...(ruleChanged ? { rrule } : {}),
				};
				saved = await window.bureau.calendar.update(event.id, patch, {
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

	const title = !event
		? "New event"
		: singleOccurrence
			? "Edit this occurrence"
			: scope === "following"
				? "Edit this and following occurrences"
				: event.rrule
					? "Edit all occurrences"
					: "Edit event";

	return (
		<Dialog title={title} onClose={onClose}>
			<form onSubmit={submit} noValidate className="mt-5">
				<div className="grid grid-cols-2 gap-4">
					<div className="col-span-2">
						<Field label="Title" required value={values.title} onChange={(v) => set("title", v)} error={titleError} />
					</div>

					<div className="col-span-2">
						<label className="flex cursor-default items-center gap-3 text-[length:var(--text-base)]">
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

					{values.allDay ? null : (
						<div className="col-span-2">
							<Select label="Time zone" value={values.timezone} onChange={(v) => set("timezone", v)} options={zones} disabled={singleOccurrence} />
						</div>
					)}

					<div className="col-span-2 border-t border-[var(--line)] pt-4">
						<RecurrenceEditor
							value={values.recurrence}
							onChange={(v) => set("recurrence", v)}
							startLocal={startLocal}
							disabled={singleOccurrence}
						/>
						{singleOccurrence ? (
							<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								The repeat rule, zone and client belong to the whole series.
							</p>
						) : null}
					</div>

					<div className="col-span-2 border-t border-[var(--line)] pt-4">
						<Field label="Location" value={values.location} onChange={(v) => set("location", v)} />
					</div>

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
						<Field label="Notes" multiline rows={3} value={values.notes} onChange={(v) => set("notes", v)} />
					</div>
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not save this event.</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
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
