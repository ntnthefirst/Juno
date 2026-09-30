import { Icon } from "../../components/Icon";

type VersionCountProps = {
	count: number;
	open: boolean;
	onToggle: () => void;
};

/**
 * "3 versions", which unfolds the list of them under the row. A button of its
 * own inside a clickable row, so it stops the click there: opening the list is
 * not opening the document.
 */
export function VersionCount({ count, open, onToggle }: VersionCountProps) {
	return (
		<button
			type="button"
			aria-expanded={open}
			onClick={(event) => {
				event.stopPropagation();
				onToggle();
			}}
			className="inline-flex h-[24px] shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
		>
			<span className="tabular">
				{count} {count === 1 ? "version" : "versions"}
			</span>
			<Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
		</button>
	);
}
