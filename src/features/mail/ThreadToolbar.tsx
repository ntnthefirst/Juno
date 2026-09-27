import type { IconName } from "../../components/Icon";
import { IconAction } from "../../components/IconAction";
import { SelectAllButton } from "../../components/SelectAllButton";
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
 * The box is there whether or not anything is selected, because a control
 * that appears once you have already done the thing it does is a control
 * nobody finds. The actions sit at the far right, away from search, so the
 * two do not read as one group.
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
	const someSelected = hasSelection && !allSelected;
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
			<SelectAllButton
				checked={allSelected}
				indeterminate={someSelected}
				disabled={visibleIds.length === 0}
				onSelectAll={onSelectAll}
				onClearSelection={onClearSelection}
			/>
			{hasSelection ? (
				<span className="tabular shrink-0 text-[length:var(--text-sm)] font-[var(--weight-medium)]">
					{selectedIds.length} selected
				</span>
			) : null}

			<MailSearchBar search={search} onSearch={onSearch} filters={filters} onFilters={onFilters} />

			{hasSelection ? (
				<div className="ml-auto flex items-center gap-1">
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
