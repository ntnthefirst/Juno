import { SelectAllButton } from "../../components/SelectAllButton";
import { SelectionBar, type SelectionAction } from "../../components/SelectionBar";
import { coversAll } from "../../lib/select-all";
import type { MailFilters } from "./mail-filters";
import { MailSearchBar } from "./MailSearchBar";
import type { ThreadAction } from "./ThreadList";

type ThreadToolbarProps = {
	search: string;
	onSearch: (value: string) => void;
	filters: MailFilters;
	onFilters: (next: MailFilters) => void;
	/** The trash offers "delete forever" where every other folder offers "trash". */
	inTrash: boolean;
	/** The rows the list is showing, which is what the box selects. */
	visibleIds: string[];
	/**
	 * Every id the list matches, once select all has asked. The list may render
	 * only part of them, so "all selected" is judged against these when known.
	 */
	matchingIds: string[] | null;
	selectedIds: string[];
	onSelectAll: () => void;
	onClearSelection: () => void;
	onAction: (action: ThreadAction, ids: string[]) => void;
	/** A title in place of search, for a list where searching makes no sense. */
	heading?: string;
};

/**
 * The row above the list. At rest it holds the box that takes the whole page,
 * and in Drafts the heading. Once a thread is held the shared selection bar
 * takes its place: the count, what can be done to the threads, and Clear.
 *
 * Search lives in the title bar (`MailSearchBar` puts it there), so it keeps
 * working while threads are held. Picking three threads, searching for a
 * fourth and adding it is the normal way to build a selection, which is why
 * the search is rendered whatever this row shows.
 *
 * Drafts gives a `heading` instead of search: its list also holds messages
 * that are not threads, and a search across the account would leave the folder.
 */
export function ThreadToolbar({
	search,
	onSearch,
	filters,
	onFilters,
	inTrash,
	visibleIds,
	matchingIds,
	selectedIds,
	onSelectAll,
	onClearSelection,
	onAction,
	heading,
}: ThreadToolbarProps) {
	const hasSelection = selectedIds.length > 0;
	const allSelected = coversAll(matchingIds ?? visibleIds, selectedIds);
	const act = (action: ThreadAction) => () => onAction(action, selectedIds);

	const actions: SelectionAction[] = [
		{ id: "archive", icon: "archive", label: "Archive", onSelect: act("archive") },
		{ id: "move", icon: "projects", label: "Move", description: "Move to folder", onSelect: act("move") },
		{ id: "markRead", icon: "read", label: "Mark read", onSelect: act("markRead") },
		{ id: "flag", icon: "flag", label: "Flag", onSelect: act("flag") },
		{ id: "junk", icon: "junk", label: "Junk", onSelect: act("junk") },
		inTrash
			? { id: "deleteForever", icon: "remove", label: "Delete forever", description: "Delete forever", danger: true, onSelect: act("deleteForever") }
			: { id: "trash", icon: "remove", label: "Trash", description: "Move to trash", danger: true, onSelect: act("trash") },
	];

	return (
		<div className="px-4 pt-6 pb-3">
			{heading ? null : (
				<MailSearchBar search={search} onSearch={onSearch} filters={filters} onFilters={onFilters} />
			)}
			{hasSelection ? (
				<SelectionBar
					count={selectedIds.length}
					allSelected={allSelected}
					onSelectAll={onSelectAll}
					onClear={onClearSelection}
					actions={actions}
				/>
			) : (
				<div className="flex items-center gap-2">
					<SelectAllButton
						checked={false}
						indeterminate={false}
						disabled={visibleIds.length === 0}
						onSelectAll={onSelectAll}
						onClearSelection={onClearSelection}
					/>
					{heading ? <h2 className="min-w-0 text-h3 font-[var(--weight-medium)]">{heading}</h2> : null}
				</div>
			)}
		</div>
	);
}
