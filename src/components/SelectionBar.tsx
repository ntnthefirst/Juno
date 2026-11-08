import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { IconAction } from "./IconAction";
import { SelectAllButton } from "./SelectAllButton";

export type SelectionAction = {
	id: string;
	label: string;
	icon: IconName;
	/** A longer name for a screen reader and the tooltip, when the label is a single word. */
	description?: string;
	danger?: boolean;
	disabled?: boolean;
	onSelect: () => void;
};

type SelectionBarProps = {
	/** How many rows are held, which may include rows a filter is hiding. */
	count: number;
	/** Every row the list is showing is held. */
	allSelected: boolean;
	onSelectAll: () => void;
	onClear: () => void;
	actions: SelectionAction[];
	/** Icons only, for a list in a narrow column. The label stays the accessible name. */
	compact?: boolean;
};

/**
 * The one bar every list shows while rows are held (the Selection bar in each
 * list's Selecting frame): the box, the count, what can be done to the rows,
 * and a way to let go of them. It takes the place of whatever row sat above the
 * list before anything was picked, so the actions are where the eye already is.
 *
 * The box behaves as it does at rest: with some rows held it is
 * indeterminate and a click drops them; with every row held a click does the
 * same. Picking more is done on the rows, where Shift extends a run.
 */
export function SelectionBar({ count, allSelected, onSelectAll, onClear, actions, compact = false }: SelectionBarProps) {
	return (
		<div
			role="toolbar"
			aria-label="Selection"
			className="animate-fade flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-soft)] py-1 pr-1.5 pl-2"
		>
			<SelectAllButton
				checked={allSelected}
				indeterminate={!allSelected}
				onSelectAll={onSelectAll}
				onClearSelection={onClear}
			/>
			<span className="tabular shrink-0 text-base font-[var(--weight-medium)] whitespace-nowrap text-[var(--ink)]">
				{count} selected
			</span>
			<span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" />
			{actions.map((action) =>
				compact ? (
					<IconAction
						key={action.id}
						icon={action.icon}
						label={action.description ?? action.label}
						danger={action.danger}
						disabled={action.disabled}
						onClick={action.onSelect}
					/>
				) : (
					<Button
						key={action.id}
						size="dense"
						variant={action.danger ? "danger" : "quiet"}
						disabled={action.disabled}
						aria-label={action.description}
						title={action.description}
						onClick={action.onSelect}
					>
						<Icon name={action.icon} size={14} />
						<span className="whitespace-nowrap">{action.label}</span>
					</Button>
				),
			)}
			<span className="min-w-0 flex-1" />
			<Button size="dense" onClick={onClear}>
				Clear
			</Button>
		</div>
	);
}
