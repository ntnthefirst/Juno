const EVENT = "juno:open-client";

type PendingClient = { id: string; name: string };

// Held beside the event because the clients screen may not be mounted yet when
// the request is made, and a screen that mounts afterwards still has to find it.
let pending: PendingClient | null = null;

/** Asks the shell to show the clients screen with this client open. */
export function requestOpenClient(id: string, name: string): void {
	pending = { id, name };
	window.dispatchEvent(new CustomEvent(EVENT));
}

export function peekPendingClient(): PendingClient | null {
	return pending;
}

export function clearPendingClient(): void {
	pending = null;
}

export function onOpenClientRequest(listener: () => void): () => void {
	window.addEventListener(EVENT, listener);
	return () => window.removeEventListener(EVENT, listener);
}
