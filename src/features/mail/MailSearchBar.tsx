import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { activeFilterCount, NO_FILTERS, type MailFilters } from "./mail-filters";

type MailSearchBarProps = {
	search: string;
	onSearch: (value: string) => void;
	filters: MailFilters;
	onFilters: (next: MailFilters) => void;
};

/**
 * One control: a search box with the filters folded into it.
 *
 * Every filter used to need a button of its own along the top, which spends the
 * width of the list on states nobody has switched on. They live behind the
 * funnel instead, and the funnel carries a count so a list filtered down to
 * nothing still says why.
 */
export function MailSearchBar({ search, onSearch, filters, onFilters }: MailSearchBarProps) {
	const [open, setOpen] = useState(false);
	const wrapper = useRef<HTMLDivElement>(null);
	const count = activeFilterCount(filters);

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

	function toggle(key: "unreadOnly" | "flaggedOnly" | "withAttachments") {
		onFilters({ ...filters, [key]: !filters[key] });
	}

	return (
		<div ref={wrapper} className="relative">
			<div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pr-1 pl-2 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
				<Icon name="search" size={14} />
				<input
					type="search"
					value={search}
					onChange={(event) => onSearch(event.target.value)}
					placeholder="Search mail"
					aria-label="Search mail"
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
				<button
					type="button"
					aria-label="Filters"
					title="Filters"
					aria-expanded={open}
					onClick={() => setOpen((current) => !current)}
					className={[
						"inline-flex h-[28px] shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5",
						count > 0 || open
							? "bg-[var(--accent-soft)] text-[var(--accent)]"
							: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
					].join(" ")}
				>
					<Icon name="filter" size={14} />
					{count > 0 ? <span className="tabular text-[length:var(--text-micro)]">{count}</span> : null}
				</button>
			</div>

			{open ? (
				<div
					role="group"
					aria-label="Mail filters"
					className="animate-pop absolute top-full right-0 left-0 z-20 mt-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]"
				>
					<div className="flex flex-wrap gap-1">
						<FilterToggle
							label="Unread"
							icon="unread"
							on={filters.unreadOnly}
							onClick={() => toggle("unreadOnly")}
						/>
						<FilterToggle
							label="Flagged"
							icon="flag"
							on={filters.flaggedOnly}
							onClick={() => toggle("flaggedOnly")}
						/>
						<FilterToggle
							label="Attachment"
							icon="attachment"
							on={filters.withAttachments}
							onClick={() => toggle("withAttachments")}
						/>
					</div>
					<div className="mt-3">
						<Field
							label="Address"
							value={filters.fromAddress}
							onChange={(value) => onFilters({ ...filters, fromAddress: value })}
							type="email"
							placeholder="laura@obet.be"
							help="Anyone on the thread, sender or recipient."
						/>
					</div>
					<div className="mt-3 grid grid-cols-2 gap-2">
						<Field
							label="From date"
							type="date"
							tabular
							value={filters.since}
							onChange={(value) => onFilters({ ...filters, since: value })}
						/>
						<Field
							label="To date"
							type="date"
							tabular
							value={filters.until}
							onChange={(value) => onFilters({ ...filters, until: value })}
						/>
					</div>
					<div className="mt-3 flex justify-between">
						<Button size="dense" disabled={count === 0} onClick={() => onFilters(NO_FILTERS)}>
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
	icon: Parameters<typeof Icon>[0]["name"];
	on: boolean;
	onClick: () => void;
};

function FilterToggle({ label, icon, on, onClick }: FilterToggleProps) {
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
