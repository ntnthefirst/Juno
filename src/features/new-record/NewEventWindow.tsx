import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CalendarEventInput, NewRecordPrefill, RecurrencePattern, ReminderInput } from "@shared/types";
import { Combobox, type ComboboxOption } from "../../components/Combobox";
import { Icon } from "../../components/Icon";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { Segmented } from "../../components/Segmented";
import { messageOf } from "../../lib/errors";
import {
	addDays,
	addLocalMinutes,
	dateOf,
	daysBetween,
	joinLocal,
	localMinutesBetween,
	machineTimeZone,
	timeOf,
	todayIso,
} from "../calendar/dates";
import { buildRule, DEFAULT_STATE, type Frequency } from "../calendar/recurrence";
import { DateField } from "./DateField";
import { LabelledRow } from "./LabelledRow";
import { RecordWindow } from "./RecordWindow";
import { RepeatSelect } from "./RepeatSelect";
import { TimeField } from "./TimeField";
import { usePickLists } from "./use-pick-lists";

type Kind = "event" | "reminder";

type NewEventWindowProps = {
	/** Which side of the switch it opens on: `#/new/event` or `#/new/reminder`. */
	kind: Kind;
	prefill: NewRecordPrefill;
};

type EventRepeat = "" | Frequency;

const EVENT_REPEATS: { value: EventRepeat; label: string }[] = [
	{ value: "", label: "Does not repeat" },
	{ value: "DAILY", label: "Every day" },
	{ value: "WEEKLY", label: "Every week" },
	{ value: "MONTHLY", label: "Every month" },
	{ value: "YEARLY", label: "Every year" },
];

/** Counted in ones. A longer interval is a reason to edit the reminder afterwards. */
const REMINDER_REPEATS: { value: RecurrencePattern; label: string }[] = [
	{ value: "once", label: "Does not repeat" },
	{ value: "days", label: "Every day" },
	{ value: "weeks", label: "Every week" },
	{ value: "months", label: "Every month" },
	{ value: "years", label: "Every year" },
	{ value: "quarter_end", label: "End of every quarter" },
];

const KINDS = [
	{ id: "event" as const, label: "Event" },
	{ id: "reminder" as const, label: "Reminder" },
];

type Times = { startDate: string; startTime: string; endDate: string; endTime: string; allDay: boolean };

/**
 * Where the form starts. A click on the grid brings a start and an end, and an
 * all-day click brings a date with an exclusive end, which the form shows as
 * the last day itself. With nothing, it is nine o'clock today for an hour.
 */
function initialTimes(prefill: NewRecordPrefill): Times {
	const allDay = prefill.allDay === true;
	const startLocal = prefill.startLocal ?? joinLocal(prefill.date ?? todayIso(), "09:00");
	const startDate = dateOf(startLocal);
	if (allDay) {
		const endDate = prefill.endLocal ? addDays(dateOf(prefill.endLocal), -1) : startDate;
		return { startDate, startTime: "09:00", endDate: endDate < startDate ? startDate : endDate, endTime: "10:00", allDay };
	}
	const start = timeOf(startLocal) || "09:00";
	const endLocal = prefill.endLocal ?? addLocalMinutes(joinLocal(startDate, start), 60);
	return { startDate, startTime: start, endDate: dateOf(endLocal), endTime: timeOf(endLocal) || "10:00", allDay };
}

/** "Peeters' projects", "Jansen's projects". */
function possessive(name: string): string {
	return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

const FIELD =
	"rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]";

/**
 * New event and new reminder, one window with a switch between the two
 * (design frames 175:12676, 184:44, 184:142, 184:270, 184:399 and 184:515).
 * Switching keeps the title, the client, the project, the notes and the date;
 * what only one of them has (a location, an end, a due time) is kept too, for
 * when the switch goes back.
 *
 * A new event is always in the computer's time zone. Its times are wall-clock
 * strings here and the service stores the instants in UTC.
 */
export function NewEventWindow({ kind: initialKind, prefill }: NewEventWindowProps) {
	const lists = usePickLists();
	const titleRef = useRef<HTMLInputElement>(null);
	const clientInputId = useId();
	const notesId = useId();
	const [kind, setKind] = useState<Kind>(initialKind);
	const [initial] = useState(() => initialTimes(prefill));
	const [title, setTitle] = useState("");
	const [location, setLocation] = useState("");
	const [times, setTimes] = useState<Times>(initial);
	const [dueTime, setDueTime] = useState("");
	const [eventRepeat, setEventRepeat] = useState<EventRepeat>("");
	const [reminderRepeat, setReminderRepeat] = useState<RecurrencePattern>("once");
	// Undefined until a person picks: until then the client is the one the
	// window was opened from, or the client of the project it was opened from.
	const [clientChoice, setClientChoice] = useState<string | null | undefined>(undefined);
	const [projectId, setProjectId] = useState<string | null>(prefill.projectId ?? null);
	const [madeClients, setMadeClients] = useState<ComboboxOption[]>([]);
	const [madeProjects, setMadeProjects] = useState<(ComboboxOption & { clientId: string })[]>([]);
	// While the client list is open the client field takes the whole row, as
	// frame 184:142 draws it, and the project field comes back after.
	const [choosingClient, setChoosingClient] = useState(false);
	const [notes, setNotes] = useState("");
	const [titleError, setTitleError] = useState<string | null>(null);
	const [timeError, setTimeError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		titleRef.current?.focus();
	}, []);

	const prefillClientId =
		prefill.clientId ?? lists.projects.find((project) => project.id === prefill.projectId)?.clientId ?? null;
	const clientId = clientChoice !== undefined ? clientChoice : prefillClientId;

	const clientOptions = useMemo<ComboboxOption[]>(
		() => [...lists.clients.map((client) => ({ id: client.id, label: client.name, meta: client.city })), ...madeClients],
		[lists.clients, madeClients],
	);
	const clientName = clientOptions.find((option) => option.id === clientId)?.label ?? null;

	const projectOptions = useMemo<ComboboxOption[]>(() => {
		if (!clientId) return [];
		return [
			...lists.projects
				.filter((project) => project.clientId === clientId)
				.map((project) => ({ id: project.id, label: project.name, meta: project.status?.label ?? null })),
			...madeProjects.filter((project) => project.clientId === clientId),
		];
	}, [clientId, lists.projects, madeProjects]);

	function chooseClient(next: string | null) {
		setClientChoice(next);
		// A project belongs to its client, so it cannot outlive a change of client.
		if (next !== clientId) setProjectId(null);
	}

	async function makeClient(name: string) {
		setError(null);
		try {
			const client = await window.juno.clients.create({ name });
			setMadeClients((current) => [...current, { id: client.id, label: client.name, meta: null }]);
			chooseClient(client.id);
		} catch (cause: unknown) {
			setError(`Could not make the client ${name}. ${messageOf(cause)}`);
		}
	}

	async function makeProject(name: string) {
		if (!clientId) return;
		setError(null);
		try {
			const project = await window.juno.projects.create({ name, clientId });
			setMadeProjects((current) => [...current, { id: project.id, label: project.name, meta: null, clientId }]);
			setProjectId(project.id);
		} catch (cause: unknown) {
			setError(`Could not make the project ${name}. ${messageOf(cause)}`);
		}
	}

	/** Moving the start drags the end along, keeping the length. */
	function moveStart(patch: { startDate?: string; startTime?: string }) {
		setTimes((current) => {
			const next = { ...current, ...patch };
			if (current.allDay || !current.startTime || !current.endTime) {
				const days = Math.max(0, daysBetween(current.startDate, current.endDate));
				return { ...next, endDate: addDays(next.startDate, days) };
			}
			const length = localMinutesBetween(
				joinLocal(current.startDate, current.startTime),
				joinLocal(current.endDate, current.endTime),
			);
			const end = addLocalMinutes(joinLocal(next.startDate, next.startTime || "00:00"), Math.max(0, length));
			return { ...next, endDate: dateOf(end), endTime: timeOf(end) };
		});
	}

	async function saveEvent(trimmed: string) {
		const { startDate, startTime, endDate, endTime, allDay } = times;
		if (!allDay && (startTime.length === 0 || endTime.length === 0)) {
			setTimeError("Choose when it starts and ends.");
			return;
		}
		const startLocal = allDay ? startDate : joinLocal(startDate, startTime);
		// An all-day end is exclusive in storage and inclusive on the form.
		const endLocal = allDay ? addDays(endDate, 1) : joinLocal(endDate, endTime);
		if (localMinutesBetween(startLocal, endLocal) < (allDay ? 1 : 0)) {
			setTimeError("The end is before the start.");
			return;
		}
		setTimeError(null);
		setBusy(true);
		const input: CalendarEventInput = {
			title: trimmed,
			allDay,
			startLocal,
			endLocal,
			timezone: machineTimeZone(),
			rrule: eventRepeat === "" ? null : buildRule({ ...DEFAULT_STATE, freq: eventRepeat }, startLocal, allDay),
			location: location.trim() || null,
			notes: notes.trim() || null,
			clientId,
			projectId,
		};
		try {
			await window.juno.calendar.create(input);
			await window.juno.window.closeNewRecord(true);
		} catch (cause: unknown) {
			setError(`Could not save this event. ${messageOf(cause)}`);
			setBusy(false);
		}
	}

	async function saveReminder(trimmed: string) {
		setTimeError(null);
		setBusy(true);
		// dueOn stays a YYYY-MM-DD string. A Date round trip would move it by a zone offset.
		const input: ReminderInput = {
			title: trimmed,
			dueOn: times.startDate,
			dueTime: dueTime || null,
			notes: notes.trim() || null,
			pattern: reminderRepeat,
			interval: 1,
			leadDays: 0,
			category: "paperwork",
			clientId,
			projectId,
		};
		try {
			await window.juno.reminders.create(input);
			await window.juno.window.closeNewRecord(true);
		} catch (cause: unknown) {
			setError(`Could not save this reminder. ${messageOf(cause)}`);
			setBusy(false);
		}
	}

	async function save() {
		const trimmed = title.trim();
		if (trimmed.length === 0) {
			setTitleError(kind === "event" ? "Enter a title." : "Enter what to be reminded of.");
			titleRef.current?.focus();
			return;
		}
		setTitleError(null);
		setError(null);
		if (kind === "event") await saveEvent(trimmed);
		else await saveReminder(trimmed);
	}

	const event = kind === "event";

	return (
		<RecordWindow
			title={event ? "New event" : "New reminder"}
			saveLabel={event ? "Save event" : "Save reminder"}
			busy={busy}
			error={error ?? lists.error}
			madeAlongside={madeClients.length > 0 || madeProjects.length > 0}
			onSubmit={() => void save()}
		>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-4">
						<input
							ref={titleRef}
							type="text"
							aria-label="Title"
							aria-invalid={titleError ? true : undefined}
							placeholder={event ? "Add a title" : "What to be reminded of"}
							value={title}
							onChange={(change) => setTitle(change.target.value)}
							className={`${FIELD} h-11 min-w-0 flex-1 pr-2.5 pl-3 text-lg${titleError ? " !border-[var(--risk)]" : ""}`}
						/>
						<Segmented label="Kind" size="tall" options={KINDS} value={kind} onChange={setKind} />
					</div>
					{titleError ? <p className="text-sm text-[var(--risk)]">{titleError}</p> : null}
					{event ? (
						<label className={`${FIELD} flex h-9 items-center gap-2 pr-2.5 pl-3 focus-within:border-[var(--focus)] focus-within:shadow-[inset_0_0_0_1px_var(--focus)]`}>
							<Icon name="address" className="flex-none" />
							<input
								type="text"
								aria-label="Location"
								placeholder="Add a location"
								value={location}
								onChange={(change) => setLocation(change.target.value)}
								className="min-w-0 flex-1 bg-transparent text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
							/>
						</label>
					) : null}
				</div>

				<div className="flex flex-col gap-2">
					{event ? (
						<>
							<div className="flex justify-end">
								<button
									type="button"
									aria-pressed={times.allDay}
									onClick={() => setTimes((current) => ({ ...current, allDay: !current.allDay }))}
									className={[
										"flex h-9 w-40 items-center justify-center gap-2 rounded-[var(--radius-sm)] border text-base font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
										times.allDay
											? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"
											: "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--hover)]",
									].join(" ")}
								>
									<Icon name="calendar" />
									All day
								</button>
							</div>
							<LabelledRow label="Starts">
								<DateField
									label="Starts on"
									value={times.startDate}
									onChange={(startDate) => moveStart({ startDate })}
									invalid={timeError !== null}
								/>
								{times.allDay ? null : (
									<TimeField
										label="Starts at"
										value={times.startTime}
										onChange={(startTime) => moveStart({ startTime })}
										invalid={timeError !== null}
									/>
								)}
							</LabelledRow>
							<LabelledRow label="Ends">
								<DateField
									label="Ends on"
									value={times.endDate}
									onChange={(endDate) => setTimes((current) => ({ ...current, endDate }))}
									invalid={timeError !== null}
								/>
								{times.allDay ? null : (
									<TimeField
										label="Ends at"
										value={times.endTime}
										onChange={(endTime) => setTimes((current) => ({ ...current, endTime }))}
										invalid={timeError !== null}
									/>
								)}
							</LabelledRow>
							<div className="flex justify-end">
								<RepeatSelect value={eventRepeat} onChange={setEventRepeat} options={EVENT_REPEATS} />
							</div>
						</>
					) : (
						<>
							<LabelledRow label="Due">
								<DateField
									label="Due on"
									value={times.startDate}
									onChange={(startDate) => moveStart({ startDate })}
								/>
								<TimeField label="Due at" value={dueTime} onChange={setDueTime} emptyLabel="No time" />
							</LabelledRow>
							<div className="flex justify-end">
								<RepeatSelect value={reminderRepeat} onChange={setReminderRepeat} options={REMINDER_REPEATS} />
							</div>
						</>
					)}
					{timeError ? <p className="text-sm text-[var(--risk)]">{timeError}</p> : null}
				</div>

				<LabelledRow label="Client" htmlFor={clientInputId}>
					<div className="min-w-0 flex-1">
						<Combobox
							id={clientInputId}
							label="Client"
							options={clientOptions}
							value={clientId}
							onChange={chooseClient}
							placeholder="No client"
							searchPlaceholder="Search clients"
							noneLabel="No client"
							createLabel={(typed) => `New client "${typed}"`}
							onCreate={makeClient}
							onOpenChange={setChoosingClient}
							avatars
						/>
					</div>
					{clientId && clientName && !choosingClient ? (
						<div className="min-w-0 flex-1">
							<Combobox
								label="Project"
								options={projectOptions}
								value={projectId}
								onChange={setProjectId}
								placeholder="No project"
								searchPlaceholder={`Search ${possessive(clientName)} projects`}
								noneLabel="No project"
								createLabel={() => `New project for ${clientName}`}
								onCreate={makeProject}
								avatars
							/>
						</div>
					) : null}
				</LabelledRow>

				<LabelledRow label="Notes" htmlFor={notesId}>
					<MarkdownEditor id={notesId} value={notes} onChange={setNotes} rows={3} toolbar />
				</LabelledRow>
			</div>
		</RecordWindow>
	);
}
