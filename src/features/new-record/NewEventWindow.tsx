import { useMemo, useState } from "react";
import type { CalendarEventInput, NewRecordPrefill } from "@shared/types";
import { Checkbox } from "../../components/Checkbox";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import {
	addDays,
	addLocalMinutes,
	dateOf,
	joinLocal,
	localMinutesBetween,
	machineTimeZone,
	timeOf,
	todayIso,
} from "../calendar/dates";
import { buildRule, DEFAULT_STATE, type Frequency } from "../calendar/recurrence";
import { FieldRow } from "./FieldRow";
import { RecordWindow } from "./RecordWindow";
import { usePickLists } from "./use-pick-lists";

type NewEventWindowProps = {
	prefill: NewRecordPrefill;
};

type Repeat = "" | Frequency;

const REPEATS: { value: Repeat; label: string }[] = [
	{ value: "", label: "Does not repeat" },
	{ value: "DAILY", label: "Every day" },
	{ value: "WEEKLY", label: "Every week" },
	{ value: "MONTHLY", label: "Every month" },
	{ value: "YEARLY", label: "Every year" },
];

/**
 * Where the form starts. A click on the grid brings a start and an end, and an
 * all-day click brings a date with an exclusive end, which the form shows as
 * the day itself. With nothing, it is nine o'clock today for an hour.
 */
function initialTimes(prefill: NewRecordPrefill): { date: string; start: string; end: string; allDay: boolean } {
	const allDay = prefill.allDay === true;
	const startLocal = prefill.startLocal ?? joinLocal(prefill.date ?? todayIso(), "09:00");
	const endLocal =
		prefill.endLocal ?? addLocalMinutes(joinLocal(dateOf(startLocal), timeOf(startLocal) || "09:00"), 60);
	return {
		date: dateOf(startLocal),
		start: allDay ? "09:00" : timeOf(startLocal) || "09:00",
		end: allDay ? "10:00" : timeOf(endLocal) || "10:00",
		allDay,
	};
}

/** New event (frame 58:4449). */
export function NewEventWindow({ prefill }: NewEventWindowProps) {
	const lists = usePickLists();
	const [initial] = useState(() => initialTimes(prefill));
	const [title, setTitle] = useState("");
	const [date, setDate] = useState(initial.date);
	const [start, setStart] = useState(initial.start);
	const [end, setEnd] = useState(initial.end);
	const [allDay, setAllDay] = useState(initial.allDay);
	const [timezone, setTimezone] = useState(machineTimeZone);
	const [repeat, setRepeat] = useState<Repeat>("");
	const [clientId, setClientId] = useState(prefill.clientId ?? "");
	const [notes, setNotes] = useState("");
	const [titleError, setTitleError] = useState<string | null>(null);
	const [timeError, setTimeError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const zones = useMemo(() => {
		const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
		if (!list.includes(timezone)) list.unshift(timezone);
		return list.map((zone) => ({ value: zone, label: zone }));
	}, [timezone]);

	/** Moving the start drags the end along, keeping the length. */
	function moveStart(next: string) {
		if (start && end && next) {
			const length = localMinutesBetween(joinLocal(date, start), joinLocal(date, end));
			setEnd(timeOf(addLocalMinutes(joinLocal(date, next), Math.max(0, length))));
		}
		setStart(next);
	}

	async function save() {
		const trimmed = title.trim();
		setTitleError(trimmed.length === 0 ? "Enter a title." : null);
		const timesOk = date.length > 0 && (allDay || (start.length > 0 && end.length > 0));
		setTimeError(timesOk ? null : "Choose when it starts and ends.");
		if (trimmed.length === 0 || !timesOk) return;

		const startLocal = allDay ? date : joinLocal(date, start);
		// An all-day end is exclusive in storage and inclusive on the form.
		const endLocal = allDay ? addDays(date, 1) : joinLocal(date, end);
		if (!allDay && localMinutesBetween(startLocal, endLocal) < 0) {
			setTimeError("The end is before the start.");
			return;
		}

		setError(null);
		setBusy(true);
		const input: CalendarEventInput = {
			title: trimmed,
			allDay,
			startLocal,
			endLocal,
			timezone,
			rrule: repeat === "" ? null : buildRule({ ...DEFAULT_STATE, freq: repeat }, startLocal, allDay),
			location: null,
			notes: notes.trim() || null,
			clientId: clientId || null,
			projectId: prefill.projectId ?? null,
		};
		try {
			await window.juno.calendar.create(input);
			await window.juno.window.closeNewRecord(true);
		} catch (cause: unknown) {
			setError(`Could not save this event. ${messageOf(cause)}`);
			setBusy(false);
		}
	}

	return (
		<RecordWindow
			title="New event"
			saveLabel="Save event"
			busy={busy}
			error={error ?? lists.error}
			onSubmit={() => void save()}
		>
			<Field label="Title" required value={title} onChange={setTitle} error={titleError} />
			<FieldRow columns="1fr 1fr 1fr">
				<Field label="Date" type="date" required value={date} onChange={setDate} error={timeError} tabular />
				<Field label="Starts" type="time" value={start} onChange={moveStart} disabled={allDay} tabular />
				<Field label="Ends" type="time" value={end} onChange={setEnd} disabled={allDay} tabular />
			</FieldRow>
			<label className="-mt-2 flex w-fit cursor-default items-center gap-2 text-base">
				<Checkbox checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
				All day
			</label>
			<FieldRow columns="1fr 1fr">
				<Select label="Time zone" value={timezone} onChange={setTimezone} options={zones} disabled={allDay} />
				<Select label="Repeats" value={repeat} onChange={(value) => setRepeat(value as Repeat)} options={REPEATS} />
			</FieldRow>
			<Select
				label="Client"
				value={clientId}
				onChange={setClientId}
				placeholder="No client"
				options={lists.clients.map((client) => ({ value: client.id, label: client.name }))}
			/>
			<Field label="Notes" multiline rows={2} value={notes} onChange={setNotes} />
		</RecordWindow>
	);
}
