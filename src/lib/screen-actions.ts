import { useEffect, useRef } from "react";
import type { ScreenId } from "../app/screens";

/** What can be asked of a screen from outside it. One thing so far: start a new one. */
export type ScreenAction = "new";

const EVENT = "juno:screen-action";

type Request = { screen: ScreenId; action: ScreenAction };

// Held beside the event for the same reason as the other open requests: the
// screen that should act on it is not mounted yet when it is made, and one that
// mounts afterwards still has to find it.
let pending: Request | null = null;

/** Asks the shell to bring that screen up and have it do the thing: open its new-record form. */
export function requestScreenAction(screen: ScreenId, action: ScreenAction): void {
	pending = { screen, action };
	window.dispatchEvent(new CustomEvent(EVENT));
}

export function currentScreenAction(): Request | null {
	return pending;
}

export function onScreenActionRequest(listener: () => void): () => void {
	window.addEventListener(EVENT, listener);
	return () => window.removeEventListener(EVENT, listener);
}

/**
 * Called by a screen that can be asked to start something new. It runs the
 * handler once, after the screen has mounted, if a request for this screen is
 * waiting, and takes the request so nothing else acts on it.
 *
 * Read in a microtask rather than in the effect itself: the handler sets state,
 * and by then the screen has painted its list, so the form opens on top of a
 * screen that is already there.
 */
export function useScreenAction(screen: ScreenId, handler: (action: ScreenAction) => void): void {
	const latest = useRef(handler);
	useEffect(() => {
		latest.current = handler;
	});

	useEffect(() => {
		let cancelled = false;
		void Promise.resolve().then(() => {
			if (cancelled) return;
			if (pending === null || pending.screen !== screen) return;
			const { action } = pending;
			pending = null;
			latest.current(action);
		});
		return () => {
			cancelled = true;
		};
	}, [screen]);
}
