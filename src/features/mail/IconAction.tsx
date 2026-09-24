import { Icon, type IconName } from "../../components/Icon";

type IconActionProps = {
	icon: IconName;
	label: string;
	danger?: boolean;
	onClick: () => void;
};

/** A 32px icon button for a dense row. The label is the only wording it needs. */
export function IconAction({ icon, label, danger = false, onClick }: IconActionProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={[
				"inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)]",
				"transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				danger
					? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={14} />
		</button>
	);
}
