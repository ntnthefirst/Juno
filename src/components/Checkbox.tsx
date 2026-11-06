import type { InputHTMLAttributes } from "react";
import { Icon } from "./Icon";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
	/** Square selects rows, round completes a reminder. */
	shape?: "square" | "round";
	/** Some but not all of a group, which a native checkbox only has through the DOM. */
	indeterminate?: boolean;
};

/**
 * A native checkbox drawn as the design has it: 20px square or 24px round, a
 * 1.5px strong border, the iris fill when checked. The input stays the real
 * control, so labels, forms, keyboard and the indeterminate state keep working.
 */
export function Checkbox({ shape = "square", indeterminate = false, className = "", ...rest }: CheckboxProps) {
	const round = shape === "round";
	return (
		<span className={`relative inline-flex flex-none ${round ? "h-6 w-6" : "h-5 w-5"} ${className}`}>
			<input
				type="checkbox"
				ref={(element) => {
					if (element) element.indeterminate = indeterminate;
				}}
				{...rest}
				className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-[inherit] disabled:cursor-default"
			/>
			<span
				aria-hidden
				className={[
					"flex h-full w-full items-center justify-center border-[1.5px] border-[var(--line-strong)] bg-[var(--surface)] text-transparent transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
					round ? "rounded-[var(--radius-full)]" : "rounded-[var(--radius-sm)]",
					"peer-hover:border-[var(--accent)] peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:text-[var(--accent-ink)]",
					"peer-indeterminate:border-[var(--accent)] peer-indeterminate:bg-[var(--accent)] peer-indeterminate:text-[var(--accent-ink)]",
					"peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] peer-disabled:opacity-50",
				].join(" ")}
			>
				<Icon name={indeterminate ? "minus" : "check"} size={round ? 16 : 12} strokeWidth={2.5} />
			</span>
		</span>
	);
}
