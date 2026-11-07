import { MenuButton, type MenuItem } from "./Menu";
import type { IconName } from "./Icon";

type ActionMenuProps = {
	items: MenuItem[];
	/** Spoken name of the button. */
	ariaLabel: string;
	/** Drawn beside the glyph. Left out for the three-dots button. */
	label?: string;
	icon?: IconName;
	size?: "base" | "dense";
};

/**
 * The one place a record's "..." and Add menus are made.
 *
 * Both are drawn by the application for now (components/Menu.tsx). Making
 * them native is a swap inside this function and nowhere else: a caller hands
 * over a list of items and gets a button, and does not know how the list is
 * shown.
 */
export function ActionMenu({ items, ariaLabel, label, icon, size = "base" }: ActionMenuProps) {
	return <MenuButton items={items} ariaLabel={ariaLabel} label={label} icon={icon} size={size} />;
}
