import { useRef, type KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import { addDays, formatDateLong } from "../calendar/dates";

type DateFieldProps = {
	/** What the date is, for a screen reader. "Starts on". */
	label: string;
	/** `YYYY-MM-DD`. */
	value: string;
	onChange: (value: string) => void;
	invalid?: boolean;
	id?: string;
};

/**
 * A date written out in full, "Tuesday 13 October 2026", as the new event
 * window draws it (frame 175:12676). A native date input cannot show a date
 * that way, so the field is a button that shows the words and opens the native
 * picker of a date input kept out of sight beneath it. The keyboard has both:
 * Enter or Space opens the picker, and the arrow keys move the date a day, or
 * a week with Page Up and Page Down.
 */
export function DateField({ label, value, onChange, invalid = false, id }: DateFieldProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const written = value ? formatDateLong(value) : "Choose a date";

	function openPicker() {
		try {
			inputRef.current?.showPicker();
		} catch {
			// A picker that will not open leaves the arrow keys, which always work.
		}
	}

	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		const step =
			event.key === "ArrowUp" || event.key === "ArrowRight"
				? 1
				: event.key === "ArrowDown" || event.key === "ArrowLeft"
					? -1
					: event.key === "PageUp"
						? 7
						: event.key === "PageDown"
							? -7
							: 0;
		if (step === 0 || !value) return;
		event.preventDefault();
		onChange(addDays(value, step));
	}

	return (
		<div className="relative min-w-0 flex-1">
			<button
				type="button"
				id={id}
				aria-label={`${label}, ${written}`}
				aria-invalid={invalid ? true : undefined}
				onClick={openPicker}
				onKeyDown={onKeyDown}
				className={[
					"tabular flex h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--surface)] pr-2.5 pl-3 text-left text-base text-[var(--ink)]",
					invalid ? "border-[var(--risk)]" : "border-[var(--line-strong)]",
				].join(" ")}
			>
				<Icon name="calendar" className="flex-none" />
				<span className="min-w-0 flex-1 truncate">{written}</span>
			</button>
			{/* The picker opens from this input, so it lies under the field to anchor it there. */}
			<input
				ref={inputRef}
				type="date"
				tabIndex={-1}
				aria-hidden
				value={value}
				onChange={(event) => {
					if (event.target.value) onChange(event.target.value);
				}}
				className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
			/>
		</div>
	);
}
