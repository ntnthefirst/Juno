import { useEffect, useRef } from "react";
import type { NewRecordKind } from "@shared/types";
import type { ScreenId } from "../app/screens";
import { openNewRecord } from "./new-record";

/**
 * What can be asked of a screen from outside it: start its new record, or one
 * of the other things its New menu offers (app/screens.ts, `NEW_MENUS`).
 */
export type ScreenAction =
	| "new"
	| "styled-mail"
	| "new-folder"
	| "new-rule"
	| "new-block"
	| "new-reminder"
	| "subscribe"
	| "import-calendar";

const EVENT = "juno:screen-action";

/** The screens on show that act on a request where they are, rather than being brought up fresh. */
const live = new Map<ScreenId, (action: ScreenAction) => boolean>();

type Request = { screen: ScreenId; action: ScreenAction };

// Held beside the event for the same reason as the other open requests: the
// screen that should act on it is not mounted yet when it is made, and one that
// mounts afterwards still has to find it.
let pending: Request | null = null;

/**
 * The screens whose "new" makes one of the four records that have a window of
 * their own (decision 60). Those do not bring the screen up: the window opens
 * over whatever is showing, and the screen refreshes when it saves.
 */
const WINDOWED: Partial<Record<ScreenId, NewRecordKind>> = {
	overview: "reminder",
	reminders: "reminder",
	calendar: "event",
	clients: "client",
	projects: "project",
};

/**
 * Asks for a new record on that screen. For an event, a client, a project or a
 * reminder that opens its window; for the rest it asks the shell to bring the
 * screen up and have it open its own form.
 */
export function requestScreenAction(screen: ScreenId, action: ScreenAction): void {
	const windowed = action === "new" ? WINDOWED[screen] : undefined;
	if (windowed) {
		openNewRecord(windowed);
		return;
	}
	// Two items in a screen's New menu need nothing from the screen itself.
	if (action === "new-reminder") {
		openNewRecord("reminder");
		return;
	}
	if (action === "subscribe") {
		void window.juno.window.openSettings("mail", { kind: "add-calendar" });
		return;
	}
	// The screen is already showing and can act where it is, so what is open on
	// it (the message being read, the week in view) stays.
	if (live.get(screen)?.(action)) return;
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

/**
 * Called by a screen that can act on a request while it is on show. The
 * handler answers whether it took the action; one it does not take falls back
 * to bringing the screen up fresh, as `useScreenAction` handles.
 */
export function useLiveScreenAction(screen: ScreenId, handler: (action: ScreenAction) => boolean): void {
	const latest = useRef(handler);
	useEffect(() => {
		latest.current = handler;
	});

	useEffect(() => {
		const run = (action: ScreenAction) => latest.current(action);
		live.set(screen, run);
		return () => {
			if (live.get(screen) === run) live.delete(screen);
		};
	}, [screen]);
}
