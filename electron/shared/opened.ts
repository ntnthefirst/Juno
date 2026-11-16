/**
 * What the window says after a document's file was opened in its own app,
 * or null when there is nothing to say. Enter, a double click and Open on the
 * menu all end here, so the notice reads the same whichever was used.
 */
export function openedNotice(title: string, opened: { readOnly: boolean }): string | null {
	return opened.readOnly ? `${title} opened read only, because it is signed.` : null;
}
