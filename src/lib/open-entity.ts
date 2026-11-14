import type { MailAddress } from "@shared/types";
import type { ScreenId } from "../app/screens";

const EVENT = "juno:open-entity";

/** What a link anywhere in the app can open: a record, a conversation, a new message, or at least the screen it lives on. */
export type OpenTarget =
	/**
	 * A project. `tab: "documents"` opens it on its Documents tab, and
	 * `documentId` previews that document there, as a document made from a
	 * template lands where it is kept.
	 */
	| { kind: "project"; id: string; name: string; tab?: "documents"; documentId?: string }
	| { kind: "document"; id: string; name: string }
	/** A node of the documents tree, opened in the explorer: `client:<id>`, `project:<id>`, `folder:<id>`, `unfiled` or `templates`. */
	| { kind: "document-folder"; key: string }
	/** A document template, previewed on the Templates screen. */
	| { kind: "document-template"; id: string; name: string }
	/**
	 * The Templates screen. `place` is the client or project it was opened
	 * from: a document made from a template there is kept under it, and the
	 * way back goes to it.
	 */
	| { kind: "templates"; place?: TemplatesPlace | null }
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

/** Where a document made on the Templates screen is kept, and what the way back is called. */
export type TemplatesPlace = { clientId: string | null; projectId: string | null; name: string };

/** The screen that shows what a request asks for. */
export function screenFor(target: OpenTarget): ScreenId {
	switch (target.kind) {
		case "project":
			return "projects";
		case "document":
		case "document-folder":
			return "documents";
		case "document-template":
		case "templates":
			return "templates";
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
