import { createContext, useContext } from "react";

/**
 * The elements in the title bar a screen may draw its own controls into:
 * `left` is after the divider beside the way back, `right` is before New, and
 * `overflow` is the "..." after it, where a record keeps its menu. All are null until the bar has mounted. Kept apart from the
 * component that uses them so neither file loses fast refresh.
 *
 * `hideNew` takes New out of the bar until the function it returns is called.
 * A record that puts its own ways to start something at the right uses it, so
 * the bar does not offer two kinds of New side by side. Each call is counted,
 * so two screens that both ask cannot bring it back for each other.
 */
export type TitleBarSlots = {
	left: HTMLElement | null;
	right: HTMLElement | null;
	overflow: HTMLElement | null;
	hideNew: () => () => void;
};

export const TitleBarSlotContext = createContext<TitleBarSlots>({
	left: null,
	right: null,
	overflow: null,
	hideNew: () => () => undefined,
});

export function useTitleBarSlot(side: "left" | "right" | "overflow"): HTMLElement | null {
	return useContext(TitleBarSlotContext)[side];
}

export function useTitleBarHideNew(): () => () => void {
	return useContext(TitleBarSlotContext).hideNew;
}
