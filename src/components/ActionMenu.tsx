import { useRef } from "react";
import { Icon, type IconName } from "./Icon";
import { pointUnder, showNativeMenu, type MenuHandlers, type MenuTarget } from "../lib/native-menu";

type ActionMenuProps = {
	/** What the menu is opened on. The main process decides what it offers. */
	target: MenuTarget;
	/** What this screen does for each action the menu hands back. */
	handlers: MenuHandlers;
	/** Spoken name of the button. */
	ariaLabel: string;
	/** Drawn beside the glyph. Left out for the three-dots button. */
	label?: string;
	icon?: IconName;
	size?: "base" | "dense";
};

/**
 * The one place a record's "..." and Add buttons are made.
 *
 * The menu is the platform's own, built in the main process from the kind and
 * the record (decision 59). A caller says what the button is for and what the
 * screen does with each answer, and never hands over a list of items.
 */
export function ActionMenu({ target, handlers, ariaLabel, label, icon = "more", size = "base" }: ActionMenuProps) {
	const trigger = useRef<HTMLButtonElement>(null);

	const metrics =
		size === "dense"
			? label
				? "h-[32px] px-2 text-dense"
				: "h-[32px] w-[32px]"
			: label
				? "h-[40px] px-4 text-base"
				: "h-[40px] w-[40px]";

	return (
		<button
			ref={trigger}
			type="button"
			aria-label={ariaLabel}
			aria-haspopup="menu"
			title={ariaLabel}
			onClick={() => {
				if (trigger.current) void showNativeMenu(target, pointUnder(trigger.current), handlers);
			}}
			className={[
				"inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)]",
				"font-[var(--weight-medium)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				"hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-50",
				metrics,
			].join(" ")}
		>
			<Icon name={icon} />
			{label ? <span>{label}</span> : null}
		</button>
	);
}
