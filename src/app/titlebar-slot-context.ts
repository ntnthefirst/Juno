import { createContext, useContext } from "react";

/**
 * The element in the title bar a screen may draw its own controls into, or
 * null before the bar has mounted. Kept apart from the component that uses it
 * so neither file loses fast refresh.
 */
export const TitleBarSlotContext = createContext<HTMLElement | null>(null);

export function useTitleBarSlot(): HTMLElement | null {
	return useContext(TitleBarSlotContext);
}
