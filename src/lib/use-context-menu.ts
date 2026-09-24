import { useCallback, useState, type MouseEvent as ReactMouseEvent } from "react";

type Point = { x: number; y: number };

/**
 * The right-click menu state for one surface.
 *
 * Electron draws no context menu of its own, so without this a right click
 * anywhere in Juno does nothing at all, which reads as a broken window rather
 * than as a deliberate omission.
 *
 * It lives beside the components rather than inside `Menu.tsx` because a file
 * that exports both a hook and a component loses fast refresh for the
 * component, and the menu is a component that is worth editing quickly.
 *
 * Opening it stops the event, which is what lets `EditMenu` sit on the document
 * as the fallback for everything that has no menu of its own.
 */
export function useContextMenu() {
	const [at, setAt] = useState<Point | null>(null);

	const open = useCallback((event: ReactMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		// The keyboard menu key fires this with no coordinates. Hanging the menu
		// off the focused element is what a platform menu does in that case.
		if (event.clientX === 0 && event.clientY === 0 && event.currentTarget instanceof HTMLElement) {
			const box = event.currentTarget.getBoundingClientRect();
			setAt({ x: box.left + 8, y: box.top + box.height });
			return;
		}
		setAt({ x: event.clientX, y: event.clientY });
	}, []);

	const close = useCallback(() => setAt(null), []);

	return { at, open, close };
}
