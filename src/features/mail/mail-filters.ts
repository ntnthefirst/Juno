/**
 * What the list is narrowed by, beside the words typed into search.
 *
 * Its own file rather than beside the control, because a module that exports
 * both a component and a constant loses fast refresh for the component.
 */
export type MailFilters = {
	unreadOnly: boolean;
	flaggedOnly: boolean;
	withAttachments: boolean;
	/** Anyone on the thread, sender or recipient. */
	fromAddress: string;
	/** `YYYY-MM-DD`, inclusive. */
	since: string;
	until: string;
};

export const NO_FILTERS: MailFilters = {
	unreadOnly: false,
	flaggedOnly: false,
	withAttachments: false,
	fromAddress: "",
	since: "",
	until: "",
};

/** How many are on, for the count on the funnel. */
export function activeFilterCount(filters: MailFilters): number {
	return [
		filters.unreadOnly,
		filters.flaggedOnly,
		filters.withAttachments,
		filters.fromAddress.trim() !== "",
		filters.since !== "",
		filters.until !== "",
	].filter(Boolean).length;
}
