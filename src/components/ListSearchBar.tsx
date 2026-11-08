import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/** The popover's width, fixed so it can be held inside the window without measuring it. */
const POPOVER_WIDTH = 320;

/**
 * A list's search and its filters, both in the title bar: the search
 * (`TitleSearch`), where Ctrl F finds it on every list screen, and the funnel
 * right after it, which opens a popover under itself and closes on a click
 * outside or Escape. The popover is drawn over the page, not inside the bar,
 * so the bar's drag region and height do not touch it.
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
	// Where the popover hangs, read from the funnel when it opens; null is closed.
	const [at, setAt] = useState<{ top: number; left: number } | null>(null);
	const open = at !== null;
	const funnel = useRef<HTMLButtonElement>(null);
	const popover = useRef<HTMLDivElement>(null);
	const label = ariaLabel ?? placeholder;

	// Closes on a click anywhere else and on Escape, like any popover.
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!(event.target instanceof Node)) return;
			if (funnel.current?.contains(event.target) || popover.current?.contains(event.target)) return;
			setAt(null);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setAt(null);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	function toggle() {
		if (open) {
			setAt(null);
			return;
		}
		const rect = funnel.current?.getBoundingClientRect();
		if (!rect) return;
		// Hung from the funnel's right edge, so it opens towards the page, and kept inside the window.
		const left = Math.max(8, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - 8 - POPOVER_WIDTH));
		setAt({ top: rect.bottom + 4, left });
	}

	return (
		<TitleSearch
			value={search}
			onChange={onSearch}
			placeholder={label}
			trailing={
				filters ? (
					<>
						<button
							ref={funnel}
							type="button"
							aria-label="Filters"
							title="Filters"
							aria-expanded={open}
							onClick={toggle}
							className={[
								"inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-md)] px-1.5",
								filterCount > 0 || open
									? "bg-[var(--accent-soft)] text-[var(--accent)]"
									: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
							].join(" ")}
						>
							<Icon name="filter" size={14} />
							{filterCount > 0 ? <span className="tabular text-micro">{filterCount}</span> : null}
						</button>
						{at
							? createPortal(
									<div
										ref={popover}
										role="group"
										aria-label={filtersAriaLabel ?? `${label} filters`}
										className="animate-pop fixed z-[60] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]"
										style={{ top: at.top, left: at.left, width: POPOVER_WIDTH }}
									>
										{filters}
										<div className="mt-3 flex justify-between">
											<Button size="dense" disabled={filterCount === 0} onClick={() => onClearFilters?.()}>
												Clear filters
											</Button>
											<Button size="dense" onClick={() => setAt(null)}>
												Done
											</Button>
										</div>
									</div>,
									document.body,
								)
							: null}
					</>
				) : undefined
			}
		/>
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
