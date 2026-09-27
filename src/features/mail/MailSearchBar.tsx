import { Field } from "../../components/Field";
import { FilterToggle, ListSearchBar } from "../../components/ListSearchBar";
import { activeFilterCount, NO_FILTERS, type MailFilters } from "./mail-filters";

type MailSearchBarProps = {
	search: string;
	onSearch: (value: string) => void;
	filters: MailFilters;
	onFilters: (next: MailFilters) => void;
};

/**
 * Mail's own filters, slotted into the shared search bar shape
 * (`ListSearchBar.tsx`). It used to draw the search box and the popover
 * itself; every list screen with a search and a funnel needed the same
 * plumbing, so that part moved out and this is what is left: the three
 * toggles, the address field and the date range that are specific to mail.
 */
export function MailSearchBar({ search, onSearch, filters, onFilters }: MailSearchBarProps) {
	const count = activeFilterCount(filters);

	function toggle(key: "unreadOnly" | "flaggedOnly" | "withAttachments") {
		onFilters({ ...filters, [key]: !filters[key] });
	}

	return (
		<ListSearchBar
			search={search}
			onSearch={onSearch}
			placeholder="Search mail"
			filtersAriaLabel="Mail filters"
			filterCount={count}
			onClearFilters={() => onFilters(NO_FILTERS)}
			filters={
				<>
					<div className="flex flex-wrap gap-1">
						<FilterToggle
							label="Unread"
							icon="unread"
							on={filters.unreadOnly}
							onClick={() => toggle("unreadOnly")}
						/>
						<FilterToggle
							label="Flagged"
							icon="flag"
							on={filters.flaggedOnly}
							onClick={() => toggle("flaggedOnly")}
						/>
						<FilterToggle
							label="Attachment"
							icon="attachment"
							on={filters.withAttachments}
							onClick={() => toggle("withAttachments")}
						/>
					</div>
					<div className="mt-3">
						<Field
							label="Address"
							value={filters.fromAddress}
							onChange={(value) => onFilters({ ...filters, fromAddress: value })}
							type="email"
							placeholder="laura@obet.be"
							help="Anyone on the thread, sender or recipient."
						/>
					</div>
					<div className="mt-3 grid grid-cols-2 gap-2">
						<Field
							label="From date"
							type="date"
							tabular
							value={filters.since}
							onChange={(value) => onFilters({ ...filters, since: value })}
						/>
						<Field
							label="To date"
							type="date"
							tabular
							value={filters.until}
							onChange={(value) => onFilters({ ...filters, until: value })}
						/>
					</div>
				</>
			}
		/>
	);
}
