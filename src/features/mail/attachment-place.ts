import type { DocumentPlace, ThreadDocumentPlace } from "@shared/types";
import type { DocumentOwnerChoice } from "../documents/DocumentOwnerFields";

/** Where the conversation is filed now, as the reader knows it. */
export type ConversationFiling = { clientId: string | null; projectId: string | null };

/**
 * What saving to a chosen place can also file the conversation under: the
 * project, when it is not already filed there, or the client, when it has no
 * client and no project was chosen. The service decides whether the link can
 * be made; this only decides which question to show.
 */
export function linkOfferFor(choice: DocumentOwnerChoice, filing: ConversationFiling): "project" | "client" | null {
	if (choice.projectId) return choice.projectId === filing.projectId ? null : "project";
	if (choice.clientId && !filing.clientId) return "client";
	return null;
}

/** The pickers' starting point: the conversation's place, or the one the mail suggestions point at. */
export function choiceOf(place: ThreadDocumentPlace | null): DocumentOwnerChoice {
	return { clientId: place?.clientId ?? "", projectId: place?.projectId ?? "" };
}

export function placeOfChoice(choice: DocumentOwnerChoice): DocumentPlace {
	return { clientId: choice.clientId || null, projectId: choice.projectId || null };
}

export const LINK_LABELS = {
	project: "Also file this conversation under the project",
	client: "Also link this conversation to the client",
} as const;
