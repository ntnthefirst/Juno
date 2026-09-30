import { Icon, type IconName } from "./Icon";

type IconActionProps = {
	icon: IconName;
	label: string;
	danger?: boolean;
	disabled?: boolean;
	/** dense is 32px for a row, base is 40px for a toolbar or a panel header. */
	size?: "dense" | "base";
	onClick: () => void;
};

/** An icon button. The label is the only wording it needs. */
export function IconAction({ icon, label, danger = false, disabled = false, size = "dense", onClick }: IconActionProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={[
				"inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)]",
				size === "base" ? "h-[40px] w-[40px]" : "h-[32px] w-[32px]",
				"transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:opacity-40",
				danger
					? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={size === "base" ? 16 : 14} />
		</button>
	);
}
