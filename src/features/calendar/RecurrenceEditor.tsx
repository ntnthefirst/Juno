import { useId } from "react";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { dateOf } from "./dates";
import {
	DEFAULT_STATE,
	describeState,
	WEEKDAYS,
	type Frequency,
	type RecurrenceState,
	type Weekday,
} from "./recurrence";

/**
 * What the form holds for the repeat rule: nothing, a rule the builder can
 * show, or a rule it cannot, kept as text so it is never quietly simplified.
 */
export type RecurrenceValue =
	| { mode: "none" }
	| { mode: "builder"; state: RecurrenceState }
	| { mode: "custom"; rrule: string };

type RecurrenceEditorProps = {
	value: RecurrenceValue;
	onChange: (value: RecurrenceValue) => void;
	/** The event's start, which the rule is anchored to. */
	startLocal: string;
	disabled?: boolean;
	error?: string | null;
};

const FREQUENCIES: { value: string; label: string }[] = [
	{ value: "none", label: "Does not repeat" },
	{ value: "DAILY", label: "Daily" },
	{ value: "WEEKLY", label: "Weekly" },
	{ value: "MONTHLY", label: "Monthly" },
	{ value: "YEARLY", label: "Yearly" },
	{ value: "custom", label: "Custom rule" },
];

const CONTROL =
	"w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-base)] text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)] disabled:opacity-60";

export function RecurrenceEditor({ value, onChange, startLocal, disabled = false, error }: RecurrenceEditorProps) {
	const id = useId();
	const selected = value.mode === "builder" ? value.state.freq : value.mode;
	const state = value.mode === "builder" ? value.state : null;

	function setState(patch: Partial<RecurrenceState>) {
		if (!state) return;
		onChange({ mode: "builder", state: { ...state, ...patch } });
	}

	function chooseFrequency(next: string) {
		if (next === "none") onChange({ mode: "none" });
		else if (next === "custom") onChange({ mode: "custom", rrule: "" });
		else onChange({ mode: "builder", state: { ...(state ?? DEFAULT_STATE), freq: next as Frequency } });
	}

	function toggleWeekday(day: Weekday) {
		if (!state) return;
		const has = state.weekdays.includes(day);
		setState({ weekdays: has ? state.weekdays.filter((d) => d !== day) : [...state.weekdays, day] });
	}

	const unit =
		state?.freq === "DAILY" ? "days" : state?.freq === "WEEKLY" ? "weeks" : state?.freq === "MONTHLY" ? "months" : "years";

	return (
		<div className="grid grid-cols-2 gap-4">
			<Select label="Repeats" value={selected} onChange={chooseFrequency} options={FREQUENCIES} disabled={disabled} error={error} />

			{state ? (
				<div>
					<label htmlFor={`${id}-interval`} className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Every
					</label>
					<div className="flex items-center gap-2">
						<input
							id={`${id}-interval`}
							type="number"
							min={1}
							max={999}
							value={state.interval}
							disabled={disabled}
							onChange={(event) => setState({ interval: Math.max(1, Number(event.target.value) || 1) })}
							className={`${CONTROL} tabular w-20`}
						/>
						<span className="text-[length:var(--text-base)] text-[var(--ink-muted)]">{unit}</span>
					</div>
				</div>
			) : (
				<div />
			)}

			{state?.freq === "WEEKLY" ? (
				<div className="col-span-2">
					<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">On</span>
					<div className="flex gap-1" role="group" aria-label="Weekdays">
						{WEEKDAYS.map((day) => {
							const active = state.weekdays.includes(day.value);
							return (
								<button
									key={day.value}
									type="button"
									aria-pressed={active}
									aria-label={day.long}
									disabled={disabled}
									onClick={() => toggleWeekday(day.value)}
									className={`h-[32px] w-[32px] rounded-[var(--radius-sm)] text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] disabled:opacity-50 ${
										active
											? "bg-[var(--accent)] text-[var(--accent-ink)]"
											: "bg-[var(--sunken)] text-[var(--ink-muted)] hover:bg-[var(--hover)]"
									}`}
								>
									{day.label}
								</button>
							);
						})}
					</div>
					{state.weekdays.length === 0 ? (
						<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Nothing chosen means the start's own weekday.
						</p>
					) : null}
				</div>
			) : null}

			{state?.freq === "MONTHLY" ? (
				<div className="col-span-2">
					<Select
						label="On"
						value={state.monthly}
						onChange={(next) => setState({ monthly: next as "day" | "weekday" })}
						disabled={disabled}
						options={[
							{ value: "day", label: `Day ${Number(dateOf(startLocal).slice(8, 10)) || 1} of the month` },
							{ value: "weekday", label: "The same weekday of the same week" },
						]}
					/>
				</div>
			) : null}

			{state ? (
				<>
					<Select
						label="Ends"
						value={state.ends}
						onChange={(next) => setState({ ends: next as RecurrenceState["ends"] })}
						disabled={disabled}
						options={[
							{ value: "never", label: "Never" },
							{ value: "count", label: "After a number of times" },
							{ value: "until", label: "On a date" },
						]}
					/>
					{state.ends === "count" ? (
						<div>
							<label htmlFor={`${id}-count`} className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Times
							</label>
							<input
								id={`${id}-count`}
								type="number"
								min={1}
								max={999}
								value={state.count}
								disabled={disabled}
								onChange={(event) => setState({ count: Math.max(1, Number(event.target.value) || 1) })}
								className={`${CONTROL} tabular`}
							/>
						</div>
					) : state.ends === "until" ? (
						<Field
							label="Until"
							type="date"
							value={state.until}
							onChange={(next) => setState({ until: next })}
							disabled={disabled}
							tabular
						/>
					) : (
						<div />
					)}
					<p className="col-span-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{describeState(state, startLocal)}
					</p>
				</>
			) : null}

			{value.mode === "custom" ? (
				<div className="col-span-2">
					<Field
						label="Rule"
						value={value.rrule}
						onChange={(next) => onChange({ mode: "custom", rrule: next })}
						placeholder="FREQ=MONTHLY;BYDAY=-1FR"
						disabled={disabled}
					/>
					<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						An RFC 5545 rule without the RRULE: prefix. Daily, weekly, monthly or yearly.
					</p>
				</div>
			) : null}
		</div>
	);
}
