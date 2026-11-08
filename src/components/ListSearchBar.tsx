import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { TitleSearch } from "../app/TitleSearch";
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
 * A list's search and its filters. The search is in the title bar
 * (`TitleSearch`), where Ctrl F finds it on every list screen, and what stays
 * on the page is the funnel, which opens a popover and closes on a click
 * outside or Escape.
 *
 * The mail list (`MailSearchBar.tsx`) had this shape first. Every list of
 * templates, documents or records that needs a search and a handful of
 * filters grows the same parts, so they live here once.
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
		<div ref={wrapper} className="relative flex items-center">
			<TitleSearch value={search} onChange={onSearch} placeholder={label} />
			{filters ? (
				<button
					type="button"
					aria-label="Filters"
					title="Filters"
					aria-expanded={open}
					onClick={() => setOpen((current) => !current)}
					className={[
						"inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-md)] px-1.5",
						filterCount > 0 || open
							? "bg-[var(--accent-soft)] text-[var(--accent)]"
							: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
					].join(" ")}
				>
					<Icon name="filter" size={14} />
					{filterCount > 0 ? (
						<span className="tabular text-micro">{filterCount}</span>
					) : null}
				</button>
			) : null}

			{open && filters ? (
				<div
					role="group"
					aria-label={filtersAriaLabel ?? `${label} filters`}
					className="animate-pop absolute top-full left-0 z-20 mt-1 w-[320px] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]"
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
				"inline-flex h-[32px] items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-dense",
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
