import { useEffect, useRef } from "react";
import type { NewRecordKind, NewRecordPrefill } from "@shared/types";

/**
 * Making an event, a client, a project or a reminder opens a small window over
 * the application (decision 60). Everything that creates one goes through
 * here: the New menu, the palette, Ctrl N, a client or project record's quick
 * add, and a click on the calendar grid.
 */
export function openNewRecord(kind: NewRecordKind, prefill: NewRecordPrefill = {}): void {
	void window.juno.window.openNewRecord(kind, prefill);
}

const EVENT = "juno:records-changed";

/** The shell says a window saved something, so what is on screen may be stale. */
export function announceRecordsChanged(): void {
	window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * Runs `handler` when a new-record window saved something. A screen that reads
 * records passes the function that reads them again, so the new row is there
 * the moment the window closes, without remounting the screen and losing the
 * record that was open.
 */
export function useRecordsChanged(handler: () => void): void {
	const latest = useRef(handler);
	useEffect(() => {
		latest.current = handler;
	});
	useEffect(() => {
		const listener = () => latest.current();
		window.addEventListener(EVENT, listener);
		return () => window.removeEventListener(EVENT, listener);
	}, []);
}
