/**
 * Tells whoever listens that documents changed without the window asking:
 * an edit saved in another app and picked up as a new version, or anything an
 * agent did. The IPC layer subscribes and pushes `documents.changed` to every
 * window, so a service never holds a window (architecture.md section 3).
 */
import type { DocumentsChanged } from "../../shared/types";

type Listener = (event: DocumentsChanged) => void;

const listeners = new Set<Listener>();

export function onDocumentsChanged(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function announce(documentIds: string[], reason: DocumentsChanged["reason"] = "changed"): void {
	if (documentIds.length === 0 || listeners.size === 0) return;
	const event: DocumentsChanged = { documentIds: [...new Set(documentIds)], reason };
	for (const listener of listeners) {
		try {
			listener(event);
		} catch {
			// A listener that throws is not allowed to break a write.
		}
	}
}
