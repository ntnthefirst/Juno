import type { AgentEntityKind, AgentEntityRef } from "@shared/types";
import type { IconName } from "../../components/Icon";
import { requestOpenClient } from "../../lib/open-client";
import { offerDraft } from "../../lib/open-draft";
import { requestOpen, type OpenTarget } from "../../lib/open-entity";

export const KIND_ICONS: Record<AgentEntityKind, IconName> = {
	client: "client",
	contact: "client",
	project: "projects",
	mailAccount: "mail",
	mailFolder: "folder-open",
	mailThread: "branch",
	mailMessage: "mail",
	mailDraft: "drafts",
	mailTemplate: "templates",
	documentTemplate: "templates",
	document: "documents",
	reminder: "reminders",
	event: "calendar",
	automation: "agent",
};

/** Where a record without a page of its own is shown. */
const KIND_SCREENS: Partial<Record<AgentEntityKind, Extract<OpenTarget, { kind: "screen" }>["screen"]>> = {
	contact: "clients",
	mailAccount: "mail",
	mailFolder: "mail",
	mailTemplate: "templates",
	documentTemplate: "document-templates",
	reminder: "reminders",
	event: "calendar",
};

/** Whether a record can be opened from here at all. A deleted one cannot. */
export function isOpenable(entity: AgentEntityRef): boolean {
	if (entity.gone) return false;
	return entity.kind !== "automation";
}

/**
 * Opens the record a request names, as far as that is possible: the record
 * itself for a client, a project, a document, a conversation or a draft, and
 * otherwise the screen it lives on.
 */
export async function openEntity(entity: AgentEntityRef): Promise<void> {
	switch (entity.kind) {
		case "client":
			requestOpenClient(entity.id, entity.label ?? "Client");
			return;
		case "project":
			requestOpen({ kind: "project", id: entity.id, name: entity.label ?? "Project" });
			return;
		case "document":
			requestOpen({ kind: "document", id: entity.id, name: entity.label ?? "Document" });
			return;
		case "mailThread":
			requestOpen({ kind: "thread", id: entity.id, messageId: null });
			return;
		case "mailMessage": {
			const message = await window.juno.mail.messages.get(entity.id);
			if (!message) throw new Error("That message is no longer on this machine.");
			requestOpen({ kind: "thread", id: message.threadId, messageId: message.id });
			return;
		}
		case "mailDraft": {
			const draft = await window.juno.mail.outbox.get(entity.id);
			// A draft opens in the editor. One that has gone out is only a place to look.
			if (draft && (draft.state === "draft" || draft.state === "failed" || draft.state === "pending")) offerDraft(draft);
			requestOpen({ kind: "screen", screen: "mail" });
			return;
		}
		default: {
			const screen = KIND_SCREENS[entity.kind];
			if (screen) requestOpen({ kind: "screen", screen });
		}
	}
}
