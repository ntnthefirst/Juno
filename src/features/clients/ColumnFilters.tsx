import { useId } from "react";
import type { Range } from "./client-view";

type CheckOption = { value: string; label: string };

type CheckListProps = {
	options: CheckOption[];
	selected: string[];
	onChange: (selected: string[]) => void;
	emptyText: string;
};

/** Pick any number of values. Nothing picked means no filter. */
export function CheckList({ options, selected, onChange, emptyText }: CheckListProps) {
	if (options.length === 0) {
		return <p className="px-3 py-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{emptyText}</p>;
	}
	return (
		<ul className="flex flex-col">
			{options.map((option) => {
				const checked = selected.includes(option.value);
				return (
					<li key={option.value}>
						<label
							style={{ minHeight: "var(--row-height)" }}
							className="flex cursor-pointer items-center gap-2.5 px-3 hover:bg-[var(--hover)]"
						>
							<input
								type="checkbox"
								checked={checked}
								onChange={() =>
									onChange(checked ? selected.filter((value) => value !== option.value) : [...selected, option.value])
								}
								className="size-4 shrink-0 accent-[var(--accent)]"
							/>
							<span className="min-w-0 flex-1 truncate">{option.label}</span>
						</label>
					</li>
				);
			})}
		</ul>
	);
}

type RangeFieldProps = {
	label: string;
	value: Range;
	onChange: (value: Range) => void;
};

function toNumber(text: string): number | null {
	if (text.trim() === "") return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** A from and to pair. Either side can stay empty for an open end. */
export function RangeField({ label, value, onChange }: RangeFieldProps) {
	const id = useId();
	const input =
		"tabular w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-2 py-1.5 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]";
	return (
		<div className="px-3 py-1">
			<div className="mb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{label}</div>
			<div className="flex items-center gap-2">
				<input
					id={`${id}-min`}
					type="number"
					min={0}
					inputMode="numeric"
					placeholder="From"
					aria-label={`${label}, from`}
					value={value.min ?? ""}
					onChange={(event) => onChange({ ...value, min: toNumber(event.target.value) })}
					className={input}
				/>
				<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">to</span>
				<input
					id={`${id}-max`}
					type="number"
					min={0}
					inputMode="numeric"
					placeholder="To"
					aria-label={`${label}, to`}
					value={value.max ?? ""}
					onChange={(event) => onChange({ ...value, max: toNumber(event.target.value) })}
					className={input}
				/>
			</div>
		</div>
	);
}
