/**
 * What the mail templates list is narrowed by, beside the words typed into
 * search. Its own file for the same reason mail/mail-filters.ts is: a module
 * that exports both a component and a constant loses fast refresh for the
 * component.
 */
export type MailTemplateFilters = {
	/** Shipped and never edited, the same test the "unreviewed" badge uses. */
	unreviewedOnly: boolean;
	/** "all" does not narrow; the other two match `layout` being set or not. */
	layout: "all" | "canvas" | "html";
	/**
	 * Shipped templates start hidden from this list the way a picker hides
	 * them, because most of the time there is nothing to do with one. Turning
	 * this on is what brings them back so they can be looked at or restored.
	 */
	showHidden: boolean;
};

export const NO_MAIL_TEMPLATE_FILTERS: MailTemplateFilters = {
	unreviewedOnly: false,
	layout: "all",
	showHidden: false,
};

/** How many are on, for the count on the funnel. */
export function activeMailTemplateFilterCount(filters: MailTemplateFilters): number {
	return [filters.unreviewedOnly, filters.layout !== "all", filters.showHidden].filter(Boolean).length;
}
