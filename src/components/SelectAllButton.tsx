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
 * native checkbox is what carries the indeterminate state for free, which is
 * why this stays an `<input>` rather than a button drawing its own mark.
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
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				ref={(element) => {
					// Some of the page, but not all of it, is the third state a
					// checkbox only has through the DOM.
					if (element) element.indeterminate = indeterminate;
				}}
				onChange={() => (hasSelection ? onClearSelection() : onSelectAll())}
				aria-label={hasSelection ? "Clear selection" : "Select all"}
				title={hasSelection ? "Clear selection" : "Select all"}
				className="h-3.5 w-3.5 rounded-[3px] border-[var(--line-strong)] accent-[var(--accent)] disabled:opacity-40"
			/>
		</label>
	);
}
