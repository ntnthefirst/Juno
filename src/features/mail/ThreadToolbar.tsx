import type { IconName } from "../../components/Icon";
import { IconAction } from "./IconAction";
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
	selectedIds: string[];
	onSelectAll: () => void;
	onClearSelection: () => void;
	onAction: (action: ThreadAction, ids: string[]) => void;
};

type BulkButton = { action: ThreadAction; icon: IconName; label: string; danger?: boolean };

/**
 * One row above the list: the box that takes or drops the whole page, the
 * count, search, and what can be done to the selection.
 *
 * They share a row because search keeps working while something is selected.
 * Picking three threads, searching for a fourth and adding it is the normal
 * way to build a selection, so a bar that pushes search out of the way would
 * be in the way. When the width runs out the actions wrap under search rather
 * than squeezing it.
 */
export function ThreadToolbar({
	search,
	onSearch,
	filters,
	onFilters,
	inTrash,
	visibleIds,
	selectedIds,
	onSelectAll,
	onClearSelection,
	onAction,
}: ThreadToolbarProps) {
	const hasSelection = selectedIds.length > 0;
	const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
	const removeAction: ThreadAction = inTrash ? "deleteForever" : "trash";

	const bulkButtons: BulkButton[] = [
		{ action: "archive", icon: "archive", label: "Archive" },
		{ action: "move", icon: "projects", label: "Move to folder" },
		{ action: "markRead", icon: "read", label: "Mark read" },
		{ action: "flag", icon: "flag", label: "Flag" },
		{ action: "junk", icon: "junk", label: "Junk" },
		{
			action: removeAction,
			icon: "remove",
			label: inTrash ? "Delete forever" : "Move to trash",
			danger: true,
		},
	];

	return (
		<div className="flex flex-wrap items-center gap-2 px-4 pt-6 pb-3">
			{hasSelection ? (
				<>
					<label className="flex h-[32px] w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--hover)]">
						<input
							type="checkbox"
							checked={allSelected}
							ref={(element) => {
								// Some of the page, but not all of it, is the third state a
								// checkbox only has through the DOM.
								if (element) element.indeterminate = !allSelected;
							}}
							onChange={() => (allSelected ? onClearSelection() : onSelectAll())}
							aria-label={allSelected ? "Clear selection" : "Select all"}
							title={allSelected ? "Clear selection" : "Select all"}
							className="h-3.5 w-3.5 rounded-[3px] border-[var(--line-strong)] accent-[var(--accent)]"
						/>
					</label>
					<span className="tabular shrink-0 text-[length:var(--text-sm)] font-[var(--weight-medium)]">
						{selectedIds.length} selected
					</span>
				</>
			) : null}

			<div className="min-w-[200px] max-w-[360px] flex-1">
				<MailSearchBar search={search} onSearch={onSearch} filters={filters} onFilters={onFilters} />
			</div>

			{hasSelection ? (
				<div className="flex items-center gap-1">
					{bulkButtons.map((button) => (
						<IconAction
							key={button.action}
							icon={button.icon}
							label={button.label}
							danger={button.danger}
							onClick={() => onAction(button.action, selectedIds)}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
