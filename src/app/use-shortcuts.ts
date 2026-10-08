import { useEffect, useRef } from "react";
import { COMBOS, SCREEN_COMBOS, matchesCombo } from "../lib/shortcuts";
import type { ScreenId } from "./screens";

type ShortcutHandlers = {
	palette: () => void;
	goTo: (screen: ScreenId) => void;
	newItem: () => void;
	settings: () => void;
	back: () => void;
	/** Null when no lock is set up, which leaves the shortcut unbound. */
	lock: (() => void) | null;
	help: () => void;
};

/**
 * The application's own shortcuts, listened for once on the window.
 *
 * Every shortcut carries the modifier, so it works while typing: there is no
 * other meaning for Ctrl+K in a text field, and a shortcut that stops working
 * the moment a field has focus is one nobody can rely on. There is no bare-key
 * shortcut on purpose: the template editors have keys of their own, and two
 * listeners for one key is a bug that depends on which mounted first.
 *
 * While a dialog is open none of the others fire, so a shortcut cannot take you
 * to another screen from under a question that is waiting for an answer. The
 * palette is the exception: its own shortcut closes it again.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
	const latest = useRef(handlers);
	useEffect(() => {
		latest.current = handlers;
	});

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || event.repeat) return;
			const act = (run: () => void) => {
				event.preventDefault();
				event.stopPropagation();
				run();
			};
			const h = latest.current;

			if (matchesCombo(event, COMBOS.palette)) {
				// Another dialog is a question waiting; the palette is not allowed over it.
				if (document.querySelector("[role='dialog']:not([data-palette])")) return;
				act(h.palette);
				return;
			}
			if (document.querySelector("[role='dialog']")) return;

			for (const [screen, combo] of Object.entries(SCREEN_COMBOS)) {
				if (combo && matchesCombo(event, combo)) {
					act(() => h.goTo(screen as ScreenId));
					return;
				}
			}
			if (matchesCombo(event, COMBOS.newItem)) return act(h.newItem);
			if (matchesCombo(event, COMBOS.settings)) return act(h.settings);
			if (matchesCombo(event, COMBOS.back)) return act(h.back);
			if (h.lock && matchesCombo(event, COMBOS.lock)) return act(h.lock);
			if (matchesCombo(event, COMBOS.help)) return act(h.help);
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
