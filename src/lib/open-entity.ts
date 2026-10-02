import type { ScreenId } from "../app/screens";

const EVENT = "juno:open-entity";

/** What a link in the Agent tab can open: a record, a conversation, or at least the screen it lives on. */
export type OpenTarget =
	| { kind: "project"; id: string; name: string }
	| { kind: "document"; id: string; name: string }
	| { kind: "thread"; id: string; messageId: string | null }
	| { kind: "screen"; screen: ScreenId };

// Held beside the event for the same reason as the client request: the screen
// that opens it may not be mounted yet, and one that mounts afterwards still
// has to find it.
let pending: OpenTarget | null = null;

/** Asks the shell to bring that screen up with the record open. */
export function requestOpen(target: OpenTarget): void {
	pending = target;
	window.dispatchEvent(new CustomEvent(EVENT));
}

/** The waiting request, when it is of this kind. */
export function peekPending<K extends OpenTarget["kind"]>(kind: K): Extract<OpenTarget, { kind: K }> | null {
	return pending && pending.kind === kind ? (pending as Extract<OpenTarget, { kind: K }>) : null;
}

export function clearPending(): void {
	pending = null;
}

export function currentRequest(): OpenTarget | null {
	return pending;
}

export function onOpenRequest(listener: () => void): () => void {
	window.addEventListener(EVENT, listener);
	return () => window.removeEventListener(EVENT, listener);
}
