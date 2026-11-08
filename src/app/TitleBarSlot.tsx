import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTitleBarHideNew, useTitleBarSlot } from "./titlebar-slot-context";

type TitleBarSlotProps = {
	/**
	 * Left sits beside the way back. Right sits before New, where a screen's own
	 * actions go. Overflow is the "..." after New, where a record keeps its menu.
	 */
	side?: "left" | "right" | "overflow";
	/**
	 * What is drawn here takes the place of New: the bar leaves New out for as
	 * long as this slot is mounted. For a record whose own actions are the ways
	 * to start something from it (a client's Send mail, Log call, New project).
	 */
	replacesNew?: boolean;
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
export function TitleBarSlot({ side = "left", replacesNew = false, children }: TitleBarSlotProps) {
	const slot = useTitleBarSlot(side);
	const hideNew = useTitleBarHideNew();
	useEffect(() => (replacesNew ? hideNew() : undefined), [replacesNew, hideNew]);
	if (!slot) return null;
	return createPortal(<div className="no-drag flex items-center gap-1">{children}</div>, slot);
}
