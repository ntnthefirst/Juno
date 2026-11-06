import { Checkbox } from "./Checkbox";

type SelectAllButtonProps = {
	/** Every row the list is showing right now is selected. */
	checked: boolean;
	/** Some, but not all, of those rows are selected. */
	indeterminate: boolean;
	disabled?: boolean;
	onSelectAll: () => void;
	onClearSelection: () => void;
};

/**
 * The square checkbox at the left of a list's search bar: takes the whole
 * page when nothing is selected, drops the selection once anything is. A
 * shared checkbox keeps the native input underneath, which is what carries the
 * indeterminate state.
 */
export function SelectAllButton({
	checked,
	indeterminate,
	disabled = false,
	onSelectAll,
	onClearSelection,
}: SelectAllButtonProps) {
	const hasSelection = checked || indeterminate;
	return (
		<label className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--hover)] has-[:disabled]:hover:bg-transparent">
			<Checkbox
				checked={checked}
				disabled={disabled}
				indeterminate={indeterminate}
				onChange={() => (hasSelection ? onClearSelection() : onSelectAll())}
				aria-label={hasSelection ? "Clear selection" : "Select all"}
				title={hasSelection ? "Clear selection" : "Select all"}
			/>
		</label>
	);
}
