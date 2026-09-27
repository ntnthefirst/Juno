import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

type ListSearchBarProps = {
	search: string;
	onSearch: (value: string) => void;
	placeholder: string;
	/** The input's accessible name. Falls back to the placeholder. */
	ariaLabel?: string;
	/** The popover's accessible name. Falls back to "<ariaLabel> filters". */
	filtersAriaLabel?: string;
	/** The controls inside the funnel's popover. Leaving it out hides the funnel entirely. */
	filters?: ReactNode;
	/** How many filters are on, for the badge on the funnel and the Clear filters button. */
	filterCount?: number;
	onClearFilters?: () => void;
};

/**
 * A search box with the filters folded into it, behind a funnel that opens a
 * popover and closes on a click outside or Escape.
 *
 * The mail list (`MailSearchBar.tsx`) had this shape first. Every list of
 * templates, documents or records that needs a search and a handful of
 * filters grows the same three parts, so they live here once: the search
 * field stays a fixed width rather than stretching across the list, because
 * a control that grows with the window draws the eye to empty space instead
 * of to the rows underneath it.
 */
export function ListSearchBar({
	search,
	onSearch,
	placeholder,
	ariaLabel,
	filtersAriaLabel,
	filters,
	filterCount = 0,
	onClearFilters,
}: ListSearchBarProps) {
	const [open, setOpen] = useState(false);
	const wrapper = useRef<HTMLDivElement>(null);
	const label = ariaLabel ?? placeholder;

	// Closes on a click anywhere else and on Escape, like any popover.
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!(event.target instanceof Node)) return;
			if (wrapper.current?.contains(event.target)) return;
			setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={wrapper} className="relative min-w-[200px] max-w-[360px] flex-1">
			<div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pr-1 pl-2 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
				<Icon name="search" size={14} />
				<input
					type="search"
					value={search}
					onChange={(event) => onSearch(event.target.value)}
					placeholder={placeholder}
					aria-label={label}
					className="min-w-0 flex-1 bg-transparent py-1.5 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
				/>
				{search ? (
					<button
						type="button"
						aria-label="Clear search"
						title="Clear search"
						onClick={() => onSearch("")}
						className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<Icon name="close" size={12} />
					</button>
				) : null}
				{filters ? (
					<button
						type="button"
						aria-label="Filters"
						title="Filters"
						aria-expanded={open}
						onClick={() => setOpen((current) => !current)}
						className={[
							"inline-flex h-[28px] shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5",
							filterCount > 0 || open
								? "bg-[var(--accent-soft)] text-[var(--accent)]"
								: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						<Icon name="filter" size={14} />
						{filterCount > 0 ? (
							<span className="tabular text-[length:var(--text-micro)]">{filterCount}</span>
						) : null}
					</button>
				) : null}
			</div>

			{open && filters ? (
				<div
					role="group"
					aria-label={filtersAriaLabel ?? `${label} filters`}
					className="animate-pop absolute top-full right-0 left-0 z-20 mt-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]"
				>
					{filters}
					<div className="mt-3 flex justify-between">
						<Button size="dense" disabled={filterCount === 0} onClick={() => onClearFilters?.()}>
							Clear filters
						</Button>
						<Button size="dense" onClick={() => setOpen(false)}>
							Done
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

type FilterToggleProps = {
	label: string;
	icon: IconName;
	on: boolean;
	onClick: () => void;
};

/** A chip inside a filter popover: the funnel's own toggle button shape. */
export function FilterToggle({ label, icon, on, onClick }: FilterToggleProps) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={[
				"inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)]",
				on
					? "bg-[var(--accent-soft)] text-[var(--accent)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={14} />
			{label}
		</button>
	);
}
