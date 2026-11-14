import type { DocumentPlace } from "@shared/types";
import type { DocumentOwnerChoice } from "./DocumentOwnerFields";

/**
 * Where a document made from a template starts out kept: the client or the
 * project whose Documents tab the Templates screen was opened from, with its
 * name for the form to show. The person can still pick another.
 */
export type StartPlace = { place: DocumentPlace; name: string };

/** The client and project pickers, set to where the document starts out. */
export function ownerOf(start: StartPlace | null | undefined): DocumentOwnerChoice {
	return { clientId: start?.place.clientId ?? "", projectId: start?.place.projectId ?? "" };
}
