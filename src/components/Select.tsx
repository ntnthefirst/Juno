import { useId } from "react";

export type SelectOption = {
	value: string;
	label: string;
};

type SelectProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	/** The label for the empty value. Left out means the field is required. */
	placeholder?: string;
	error?: string | null;
	/** One sentence under the control, matching Field. */
	help?: string | null;
	required?: boolean;
	disabled?: boolean;
};

export function Select({
	label,
	value,
	onChange,
	options,
	placeholder,
	error,
	help,
	required = false,
	disabled = false,
}: SelectProps) {
	const id = useId();
	const errorId = `${id}-error`;
	const helpId = `${id}-help`;
	const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ");

	return (
		<div>
			<label
				htmlFor={id}
				className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]"
			>
				{label}
				{required ? <span aria-hidden> *</span> : null}
			</label>

			<select
				id={id}
				value={value}
				disabled={disabled}
				required={required}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy || undefined}
				onChange={(event) => onChange(event.target.value)}
				className={`w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-base)] text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)] disabled:opacity-60${
					error ? " border-[var(--risk)]" : ""
				}`}
			>
				{placeholder !== undefined ? <option value="">{placeholder}</option> : null}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>

			{help ? (
				<p id={helpId} className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{help}
				</p>
			) : null}

			{error ? (
				<p id={errorId} className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
		</div>
	);
}
