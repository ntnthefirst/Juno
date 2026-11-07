import type { MouseEvent as ReactMouseEvent } from "react";
import type { BlankArea, MenuContext } from "@shared/menu";
import { requestScreenAction } from "./screen-actions";
import { contextMenuFor, type MenuHandlers } from "./native-menu";

/**
 * The `onContextMenu` for the empty part of a list or a page.
 *
 * The menu is the same everywhere (New event, New reminder, New client, New
 * project, and the screen's own first), and every New asks the screen that owns
 * the record to open its form, exactly as the New menu in the title bar does.
 * A screen that can do better where it was clicked, as the month grid can with
 * a date, passes its own handler for that item.
 */
export function blankMenuFor(
	area: BlankArea,
	own: MenuHandlers = {},
	context?: MenuContext,
): (event: ReactMouseEvent) => void {
	const open = contextMenuFor(
		{ kind: "blank", id: area, ...(context ? { context } : {}) },
		{
			"new-event": () => requestScreenAction("calendar", "new"),
			"new-reminder": () => requestScreenAction("reminders", "new"),
			"new-client": () => requestScreenAction("clients", "new"),
			"new-project": () => requestScreenAction("projects", "new"),
			"new-document": () => requestScreenAction("documents", "new"),
			"new-message": () => requestScreenAction("mail", "new"),
			...own,
		},
	);
	return (event) => {
		// Text, a field, an editor or a control has its own say, not this menu.
		if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a, [contenteditable], [data-selectable]")) return;
		open(event);
	};
}
