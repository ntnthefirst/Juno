/**
 * What the document templates list is narrowed by, beside the words typed
 * into search. Its own file for the same reason mail/mail-filters.ts is: a
 * module that exports both a component and a constant loses fast refresh for
 * the component.
 */
export type DocumentTemplateFilters = {
	unreviewedOnly: boolean;
};

export const NO_DOCUMENT_TEMPLATE_FILTERS: DocumentTemplateFilters = {
	unreviewedOnly: false,
};

/** How many are on, for the count on the funnel. */
export function activeDocumentTemplateFilterCount(filters: DocumentTemplateFilters): number {
	return [filters.unreviewedOnly].filter(Boolean).length;
}
