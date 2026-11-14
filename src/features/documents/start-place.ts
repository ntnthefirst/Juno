import type { DocumentPlace } from "@shared/types";
import type { DocumentOwnerChoice } from "./DocumentOwnerFields";

/**
 * Where a document made from a template starts out kept: the node of the
 * explorer it was started from, with that node's name for the form to show.
 * The person can still pick another client or project.
 */
export type StartPlace = { place: DocumentPlace; name: string };

/** The client and project pickers, set to where the document starts out. */
export function ownerOf(start: StartPlace | null | undefined): DocumentOwnerChoice {
	return { clientId: start?.place.clientId ?? "", projectId: start?.place.projectId ?? "" };
}

/**
 * The folder to keep the document in: the one it was started from, for as
 * long as the client and project still say that folder's place. Picking
 * another client or project takes it out of the folder rather than being
 * refused by the service.
 */
export function folderFor(start: StartPlace | null | undefined, owner: DocumentOwnerChoice): string | null {
	const folderId = start?.place.folderId ?? null;
	if (!start || !folderId) return null;
	const sameClient = (owner.clientId || null) === start.place.clientId;
	const sameProject = (owner.projectId || null) === start.place.projectId;
	return sameClient && sameProject ? folderId : null;
}
