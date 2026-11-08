import { useState } from "react";
import { Icon } from "../../components/Icon";

type TimeFieldProps = {
	/** What the time is, for a screen reader. "Starts at". */
	label: string;
	/** `HH:MM`, or empty. */
	value: string;
	onChange: (value: string) => void;
	/** The words shown while the field is empty, for a time that may be left out. "No time". */
	emptyLabel?: string;
	invalid?: boolean;
};

/**
 * A time of day in a 120px field with a clock, as the new event window draws
 * it. It is a native time input, so typing, the arrow keys and clearing with
 * Backspace all work as they do everywhere else; the native picker button is
 * hidden because the field is too narrow to hold it beside the clock.
 */
export function TimeField({ label, value, onChange, emptyLabel, invalid = false }: TimeFieldProps) {
	const [focused, setFocused] = useState(false);
	// An empty native time input shows dashes. Where an empty time means
	// something, the field says what instead, until it is typed in.
	const showEmpty = emptyLabel !== undefined && value === "" && !focused;

	return (
		<div
			className={[
				"relative flex h-9 w-30 flex-none items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--surface)] pr-2.5 pl-3 text-base text-[var(--ink)]",
				"focus-within:border-[var(--focus)] focus-within:shadow-[inset_0_0_0_1px_var(--focus)]",
				invalid ? "border-[var(--risk)]" : "border-[var(--line-strong)]",
			].join(" ")}
		>
			<Icon name="time" className="flex-none" />
			<input
				type="time"
				aria-label={label}
				aria-invalid={invalid ? true : undefined}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				className={[
					"tabular min-w-0 flex-1 bg-transparent outline-none [&::-webkit-calendar-picker-indicator]:hidden",
					showEmpty ? "text-transparent" : "",
				].join(" ")}
			/>
			{showEmpty ? (
				<span aria-hidden className="pointer-events-none absolute left-9 text-[var(--ink-muted)]">
					{emptyLabel}
				</span>
			) : null}
		</div>
	);
}
