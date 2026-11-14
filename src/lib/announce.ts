/**
 * One polite live region for the whole window, read by a screen reader
 * without moving the focus. A region added to the page together with its
 * text is not read by every screen reader, which is how a toast could pass
 * unannounced, so this one is made once and stays.
 */
let region: HTMLElement | null = null;

/** Long enough for a screen reader to notice that the region emptied before the new text lands. */
const SETTLE_MS = 60;

function liveRegion(): HTMLElement {
	if (region?.isConnected) return region;
	const made = document.createElement("div");
	made.setAttribute("role", "status");
	made.setAttribute("aria-live", "polite");
	made.setAttribute("aria-atomic", "true");
	made.className = "sr-only";
	document.body.append(made);
	region = made;
	return made;
}

/** Says a sentence to a screen reader. The same sentence twice in a row is read twice. */
export function announce(message: string): void {
	const target = liveRegion();
	target.textContent = "";
	window.setTimeout(() => {
		target.textContent = message;
	}, SETTLE_MS);
}
