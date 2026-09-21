import { useId } from "react";

type FieldProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: "text" | "email" | "tel" | "url" | "date" | "time" | "password" | "number";
	placeholder?: string;
	error?: string | null;
	required?: boolean;
	multiline?: boolean;
	rows?: number;
	disabled?: boolean;
	inputMode?: "text" | "decimal";
	/** Amounts and dates line up only with tabular figures. */
	tabular?: boolean;
};

const CONTROL =
	"w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-base)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)] disabled:opacity-60";

export function Field({
	label,
	value,
	onChange,
	type = "text",
	placeholder,
	error,
	required = false,
	multiline = false,
	rows = 4,
	disabled = false,
	inputMode,
	tabular = false,
}: FieldProps) {
	const id = useId();
	const errorId = `${id}-error`;
	const classes = `${CONTROL}${tabular ? " tabular" : ""}${error ? " border-[var(--risk)]" : ""}`;

	return (
		<div>
			<label
				htmlFor={id}
				className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]"
			>
				{label}
				{required ? <span aria-hidden> *</span> : null}
			</label>

			{multiline ? (
				<textarea
					id={id}
					rows={rows}
					value={value}
					disabled={disabled}
					placeholder={placeholder}
					required={required}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
					onChange={(event) => onChange(event.target.value)}
					className={`${classes} resize-y leading-[var(--leading-normal)]`}
				/>
			) : (
				<input
					id={id}
					type={type}
					value={value}
					disabled={disabled}
					placeholder={placeholder}
					required={required}
					inputMode={inputMode}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
					onChange={(event) => onChange(event.target.value)}
					className={classes}
				/>
			)}

			{error ? (
				<p id={errorId} className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
		</div>
	);
}
