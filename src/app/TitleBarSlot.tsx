import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTitleBarSlot } from "./titlebar-slot-context";

type TitleBarSlotProps = {
	children: ReactNode;
};

/**
 * Puts a screen's own controls in the title bar, beside the way back, for as
 * long as the screen is mounted. Mail uses it for writing a message and for the
 * styled mail pane, which are about the whole screen rather than one pane.
 *
 * Everything drawn here sits inside the drag region, so it is wrapped in
 * `no-drag`: a button in a drag region does not receive clicks.
 */
export function TitleBarSlot({ children }: TitleBarSlotProps) {
	const slot = useTitleBarSlot();
	if (!slot) return null;
	return createPortal(<div className="no-drag flex items-center gap-1">{children}</div>, slot);
}
