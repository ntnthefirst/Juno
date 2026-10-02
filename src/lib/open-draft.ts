import type { MailOutboxMessage } from "@shared/types";

const EVENT = "juno:open-draft";

// Held beside the event for the same reason as the open-client request: the mail
// screen may not be mounted yet when a draft arrives, and one that mounts
// afterwards still has to find it.
let pending: MailOutboxMessage | null = null;

/** Offers a draft an agent wrote, to be opened in the editor on the mail screen. */
export function offerDraft(draft: MailOutboxMessage): void {
	pending = draft;
	window.dispatchEvent(new CustomEvent(EVENT));
}

/** The waiting draft, and forgets it so it opens once. */
export function takeOfferedDraft(): MailOutboxMessage | null {
	const draft = pending;
	pending = null;
	return draft;
}

export function onDraftOffered(listener: () => void): () => void {
	window.addEventListener(EVENT, listener);
	return () => window.removeEventListener(EVENT, listener);
}
