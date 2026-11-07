import type { MouseEvent as ReactMouseEvent } from "react";
import type { MenuAction, MenuContext, MenuKind, MenuOutcome } from "@shared/menu";

/** What a menu is opened on. The main process decides the items from this and nothing else. */
export type MenuTarget = { kind: MenuKind; id: string; context?: MenuContext };

/**
 * What the screen does for each action the main process hands back. An action
 * a screen does not list is ignored, so a screen only names what it can do.
 */
export type MenuHandlers = Partial<Record<MenuAction, () => void>> & {
	/** The main process did it. Reload what is on screen. */
	done?: (message: string | undefined) => void;
	/** It could not be done. The message is worth showing. */
	failed?: (message: string) => void;
};

type Point = { x: number; y: number };

/**
 * Where a menu opens for this event.
 *
 * The keyboard's menu key (and Shift+F10) fires the same event with no
 * coordinates. A platform menu hangs off the focused element then, and so does
 * this one.
 */
export function pointOf(event: ReactMouseEvent | MouseEvent): Point {
	if (event.clientX === 0 && event.clientY === 0 && event.currentTarget instanceof HTMLElement) {
		const box = event.currentTarget.getBoundingClientRect();
		return { x: Math.round(box.left + 8), y: Math.round(box.bottom) };
	}
	return { x: event.clientX, y: event.clientY };
}

/** The lower right corner of a button, so a menu from a button opens under it. */
export function pointUnder(element: HTMLElement): Point {
	const box = element.getBoundingClientRect();
	return { x: Math.round(box.left), y: Math.round(box.bottom + 4) };
}

/** Opens the menu and carries out what comes back. Never throws: a menu that failed is a menu that did not open. */
export async function showNativeMenu(target: MenuTarget, at: Point, handlers: MenuHandlers): Promise<void> {
	let outcome: MenuOutcome;
	try {
		outcome = await window.juno.menu.show({ ...target, ...at });
	} catch {
		return;
	}
	if (outcome.type === "ui") handlers[outcome.action]?.();
	else if (outcome.type === "done") handlers.done?.(outcome.message);
	else if (outcome.type === "failed") handlers.failed?.(outcome.message);
}

/**
 * The `onContextMenu` for one row. Stops the event, so the fallback edit menu
 * on the document does not open under the real one.
 */
export function contextMenuFor(target: MenuTarget, handlers: MenuHandlers) {
	return (event: ReactMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		void showNativeMenu(target, pointOf(event), handlers);
	};
}
