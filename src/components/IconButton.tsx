import { Icon, type IconName } from "./Icon";

type IconButtonProps = {
	icon: IconName;
	/** Its whole wording: spoken name and tooltip. There is no text beside it. */
	label: string;
	/** Base is 40px with a 20px glyph, dense is 32px with a 16px one. Dense sits in a row. */
	size?: "base" | "dense";
	/** The control is on: an iris tint, as the design draws the selected style. */
	selected?: boolean;
	danger?: boolean;
	/** The one action a surface exists for, drawn in the accent. */
	primary?: boolean;
	disabled?: boolean;
	/** True when pressing it opens a side panel, so that panel does not close on the press. */
	opensPanel?: boolean;
	onClick: () => void;
};

/**
 * A small icon button for an action that has a well-known picture: edit, delete,
 * snooze. It is the 32px target the dense rows allow and carries its name in
 * `aria-label` and the tooltip, so keep the picture honest: an icon that needs
 * its label to be understood is a text button.
 */
export function IconButton({
	icon,
	label,
	size = "dense",
	selected = false,
	danger = false,
	primary = false,
	disabled = false,
	opensPanel = false,
	onClick,
}: IconButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			data-opens-panel={opensPanel ? "" : undefined}
			onClick={onClick}
			className={[
				size === "base" ? "h-[40px] w-[40px]" : "h-[32px] w-[32px]",
				"flex flex-none items-center justify-center rounded-[var(--radius-md)]",
				"transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] active:scale-90 disabled:pointer-events-none disabled:opacity-50",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
				danger
					? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
					: selected
						? "bg-[var(--accent-soft)] text-[var(--accent)]"
						: primary
						? "text-[var(--accent)] hover:bg-[var(--accent-soft)]"
						: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={size === "base" ? 20 : 16} />
		</button>
	);
}
