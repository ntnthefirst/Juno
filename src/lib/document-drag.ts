import type { DragEvent } from "react";

/**
 * Dragging documents out of Juno (decision 75): the row's own drag is
 * cancelled and the main process starts the platform's, carrying a copy of
 * each one's newest file, so it lands on the desktop, in Explorer or in
 * another app as a file.
 *
 * A drag like that coming back into Juno arrives as files. It is recognised
 * here by the names the main process gave the copies, and a drop target asks
 * `ownDrop` first so a document moved onto a folder is moved, and one dropped
 * on the composer is attached, rather than added again as a new file.
 */

type Outgoing = { ids: string[]; names: string[] | null; at: number };

/** A drag is not held this long; past it, files coming in are someone else's. */
const STALE_MS = 120_000;

let outgoing: Outgoing | null = null;
let listening = false;

function current(): Outgoing | null {
	if (outgoing && Date.now() - outgoing.at > STALE_MS) outgoing = null;
	return outgoing;
}

function forget(): void {
	outgoing = null;
}

/** The drag is over once the pointer moves again with no button held, wherever it was let go. */
function listen(): void {
	if (listening) return;
	listening = true;
	window.addEventListener("pointermove", (event) => {
		if (outgoing && event.buttons === 0) forget();
	});
	// After every drop target has had its turn, so the one that wanted it could ask.
	window.addEventListener("drop", () => window.setTimeout(forget, 0));
}

/** Starts the platform's drag for these documents in place of the row's own. */
export function dragDocumentsOut(event: DragEvent, ids: string[]): void {
	event.preventDefault();
	listen();
	const drag: Outgoing = { ids, names: null, at: Date.now() };
	outgoing = drag;
	void window.juno.documents
		.startDrag(ids)
		.then((names) => {
			if (outgoing === drag) drag.names = names;
			if (names.length === 0 && outgoing === drag) forget();
		})
		.catch(forget);
}

/** Whether a drag over the window is one of Juno's own documents, so no "drop to add" is drawn for it. */
export function isOwnDrag(): boolean {
	return current() !== null;
}

/** The documents a drop of files carries when it is Juno's own drag coming back, or null for files from elsewhere. */
export function ownDrop(files: readonly File[]): string[] | null {
	const drag = current();
	if (!drag) return null;
	const names = drag.names;
	if (!names) return files.length === drag.ids.length ? drag.ids : null;
	const dropped = files.map((file) => file.name);
	const ours = dropped.length === names.length && dropped.every((name) => names.includes(name));
	return ours ? drag.ids : null;
}
