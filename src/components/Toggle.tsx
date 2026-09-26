import { useId } from "react";

type ToggleProps = {
	checked: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	/** The setting's name, which is also the switch's accessible name. */
	label: string;
	/** One line under the name saying what the setting does. */
	description?: string;
};

/**
 * An on and off setting that applies the moment it is flipped. A checkbox
 * reads as something a form submits later, which none of these are.
 *
 * The name and its explanation sit on the left and the switch on the right,
 * and the whole row is the button, so the target is the text as well as the
 * 32px track.
 */
export function Toggle({ checked, onChange, disabled = false, label, description }: ToggleProps) {
	const labelId = useId();
	const descriptionId = useId();

	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-labelledby={labelId}
			aria-describedby={description ? descriptionId : undefined}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className="group flex w-full min-h-[40px] items-center justify-between gap-6 rounded-[var(--radius-md)] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus)] disabled:opacity-50"
		>
			<span className="flex min-w-0 flex-col gap-1">
				<span id={labelId} className="text-[length:var(--text-base)] text-[var(--ink)]">
					{label}
				</span>
				{description ? (
					<span
						id={descriptionId}
						className="max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]"
					>
						{description}
					</span>
				) : null}
			</span>
			<span
				aria-hidden
				className={[
					"relative inline-flex h-[18px] w-[32px] flex-none items-center rounded-full transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
					checked
						? "bg-[var(--accent)] group-hover:bg-[var(--accent-hover)]"
						: "bg-[var(--line-strong)] group-hover:bg-[var(--ink-faint)]",
				].join(" ")}
			>
				<span
					className={[
						"absolute left-[2px] h-[14px] w-[14px] rounded-full transition-transform duration-[var(--duration-fast)] ease-[var(--ease)]",
						checked ? "translate-x-[14px] bg-[var(--accent-ink)]" : "translate-x-0 bg-[var(--surface)]",
					].join(" ")}
				/>
			</span>
		</button>
	);
}
