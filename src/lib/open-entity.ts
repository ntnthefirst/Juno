import type { MailAddress } from "@shared/types";
import type { ScreenId } from "../app/screens";

const EVENT = "juno:open-entity";

/** What a link anywhere in the app can open: a record, a conversation, a new message, or at least the screen it lives on. */
export type OpenTarget =
	/**
	 * A project. `tab: "documents"` opens it on its Documents tab, and
	 * `documentId` previews that document there.
	 */
	| { kind: "project"; id: string; name: string; tab?: "documents"; documentId?: string }
	/**
	 * A document, previewed over the screen it was asked for from (a page opens
	 * to write in), which closing goes back to. It is on its client's or
	 * project's Documents tab too.
	 */
	| { kind: "document"; id: string; name: string }
	| { kind: "note"; id: string }
	| { kind: "thread"; id: string; messageId: string | null }
	| { kind: "mail-template"; id: string; mode: "view" | "edit" }
	/**
	 * An event, shown in its panel on the calendar. `date` (YYYY-MM-DD) is the
	 * occurrence to show; without it the calendar reads the event's own start.
	 */
	| { kind: "event"; id: string; date?: string }
	/** A reminder, opened in its form on the Reminders screen. */
	| { kind: "reminder"; id: string }
	/** A new message in the composer on the Mail screen, addressed and filed as given. */
	| { kind: "compose"; to: MailAddress[]; clientId?: string | null; projectId?: string | null }
	| { kind: "screen"; screen: ScreenId };

/** The screen that shows what a request asks for. */
export function screenFor(target: OpenTarget): ScreenId {
	switch (target.kind) {
		case "project":
			return "projects";
		case "document":
			// Never landed on: the shell draws a document over the screen in view.
			return "overview";
		case "note":
			return "notes";
		case "thread":
		case "compose":
			return "mail";
		case "mail-template":
			return "mail-templates";
		case "event":
			return "calendar";
		case "reminder":
			return "reminders";
		case "screen":
			return target.screen;
	}
}

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
