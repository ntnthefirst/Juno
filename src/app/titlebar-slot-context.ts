import { createContext, useContext } from "react";

/**
 * The elements in the title bar a screen may draw its own controls into:
 * `left` is after the divider beside the way back, `right` is before New, and
 * `overflow` is the "..." after it, where a record keeps its menu. All are null until the bar has mounted. Kept apart from the
 * component that uses them so neither file loses fast refresh.
 */
export type TitleBarSlots = { left: HTMLElement | null; right: HTMLElement | null; overflow: HTMLElement | null };

export const TitleBarSlotContext = createContext<TitleBarSlots>({ left: null, right: null, overflow: null });

export function useTitleBarSlot(side: "left" | "right" | "overflow"): HTMLElement | null {
	return useContext(TitleBarSlotContext)[side];
}
