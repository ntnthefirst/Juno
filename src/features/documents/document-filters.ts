/**
 * What the documents list is narrowed by, beside the words typed into
 * search. Its own file for the same reason mail/mail-filters.ts is: a module
 * that exports both a component and a constant loses fast refresh for the
 * component.
 */
export type DocumentFilters = {
	/** A reference status id, or "" for any. */
	statusId: string;
	/** A client id, or "" for any. */
	clientId: string;
	specimenOnly: boolean;
};

export const NO_DOCUMENT_FILTERS: DocumentFilters = {
	statusId: "",
	clientId: "",
	specimenOnly: false,
};

/** How many are on, for the count on the funnel. */
export function activeDocumentFilterCount(filters: DocumentFilters): number {
	return [filters.statusId !== "", filters.clientId !== "", filters.specimenOnly].filter(Boolean).length;
}
