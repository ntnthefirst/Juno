import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTitleBarSlot } from "./titlebar-slot-context";

type TitleBarSlotProps = {
	/** Left sits beside the way back. Right sits before the agent button, where a screen's own actions go. */
	side?: "left" | "right";
	children: ReactNode;
};

/**
 * Puts a screen's own controls in the title bar for as long as the screen is
 * mounted. Mail uses it for the styled mail pane, which is about the whole
 * screen rather than one pane.
 *
 * Everything drawn here sits inside the drag region, so it is wrapped in
 * `no-drag`: a button in a drag region does not receive clicks.
 */
export function TitleBarSlot({ side = "left", children }: TitleBarSlotProps) {
	const slot = useTitleBarSlot(side);
	if (!slot) return null;
	return createPortal(<div className="no-drag flex items-center gap-1">{children}</div>, slot);
}
