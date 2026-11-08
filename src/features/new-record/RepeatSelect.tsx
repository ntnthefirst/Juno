import { Icon } from "../../components/Icon";

type RepeatSelectProps<Value extends string> = {
	value: Value;
	onChange: (value: Value) => void;
	options: { value: Value; label: string }[];
};

/**
 * How often it comes back, as a 160px select with a chevron, sitting at the
 * right under the times it repeats (frame 175:12676). A native select, so the
 * list and the keyboard are the platform's.
 */
export function RepeatSelect<Value extends string>({ value, onChange, options }: RepeatSelectProps<Value>) {
	return (
		<div className="relative w-40 flex-none">
			<select
				aria-label="Repeat"
				value={value}
				onChange={(event) => onChange(event.target.value as Value)}
				className="h-9 w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] pr-8 pl-3 text-base text-[var(--ink)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<Icon name="chevron-down" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--ink)]" />
		</div>
	);
}
