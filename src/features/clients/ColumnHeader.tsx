import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import type { SortDirection } from "./client-view";

type ColumnHeaderProps = {
	label: string;
	align?: "left" | "right";
	direction: SortDirection | null;
	filtered: boolean;
	onCycleSort: () => void;
	onSort: (direction: SortDirection | null) => void;
	/** The filter controls for this column. Left out when the column can only be sorted. */
	children?: ReactNode;
	onClearFilter?: () => void;
};

// A double click is two clicks first. Waiting this long before a single click
// acts lets the second one cancel it, so opening the menu does not also re-sort.
const DOUBLE_CLICK_MS = 240;
const MARGIN = 8;

const SORT_WORDS: Record<string, [string, string]> = {
	Name: ["A to Z", "Z to A"],
	Status: ["A to Z", "Z to A"],
	City: ["A to Z", "Z to A"],
	Projects: ["Fewest first", "Most first"],
};

/**
 * A table header that sorts on a click and opens a menu on a double click or on
 * the chevron. The chevron takes the accent colour while a filter is narrowing
 * the list, so a short list is never a mystery.
 */
export function ColumnHeader({
	label,
	align = "left",
	direction,
	filtered,
	onCycleSort,
	onSort,
	children,
	onClearFilter,
}: ColumnHeaderProps) {
	const cell = useRef<HTMLTableCellElement>(null);
	const timer = useRef<number | null>(null);
	const [at, setAt] = useState<{ x: number; y: number } | null>(null);

	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);

	function open() {
		const box = cell.current?.getBoundingClientRect();
		if (box) setAt({ x: align === "right" ? box.right : box.left, y: box.bottom + 4 });
	}

	function onLabelClick() {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			onCycleSort();
		}, DOUBLE_CLICK_MS);
	}

	function onLabelDoubleClick() {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = null;
		open();
	}

	const words = SORT_WORDS[label] ?? ["Ascending", "Descending"];
	const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";

	return (
		<th
			ref={cell}
			aria-sort={ariaSort}
			className={[
				"border-b border-[var(--line)] px-3 pb-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]",
				align === "right" ? "text-right" : "text-left",
			].join(" ")}
		>
			<div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
				<button
					type="button"
					onClick={onLabelClick}
					onDoubleClick={onLabelDoubleClick}
					title="Click to sort, double click for options"
					className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
				>
					{label}
					{direction ? (
						<Icon name={direction === "asc" ? "move-up" : "move-down"} className="size-3 text-[var(--accent)]" />
					) : null}
				</button>
				<button
					type="button"
					aria-label={`${label} options`}
					aria-haspopup="dialog"
					aria-expanded={at !== null}
					onClick={() => (at ? setAt(null) : open())}
					className={[
						"-my-1 inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--hover)]",
						"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]",
						filtered ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--ink-faint)]",
					].join(" ")}
				>
					<Icon name="chevron-down" className="size-3.5" />
				</button>
			</div>

			{at ? (
				<ColumnPopover
					at={at}
					alignRight={align === "right"}
					label={label}
					onClose={() => setAt(null)}
					direction={direction}
					sortWords={words}
					onSort={onSort}
					filtered={filtered}
					onClearFilter={onClearFilter}
				>
					{children}
				</ColumnPopover>
			) : null}
		</th>
	);
}

type ColumnPopoverProps = {
	at: { x: number; y: number };
	alignRight: boolean;
	label: string;
	onClose: () => void;
	direction: SortDirection | null;
	sortWords: [string, string];
	onSort: (direction: SortDirection | null) => void;
	filtered: boolean;
	onClearFilter?: () => void;
	children?: ReactNode;
};

function ColumnPopover({
	at,
	alignRight,
	label,
	onClose,
	direction,
	sortWords,
	onSort,
	filtered,
	onClearFilter,
	children,
}: ColumnPopoverProps) {
	const surface = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

	useLayoutEffect(() => {
		const node = surface.current;
		if (!node) return;
		const { width, height } = node.getBoundingClientRect();
		let left = alignRight ? at.x - width : at.x;
		let top = at.y;
		if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - width;
		if (left < MARGIN) left = MARGIN;
		if (top + height > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - MARGIN - height);
		setPosition({ left, top });
	}, [at.x, at.y, alignRight]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
		// Only a resize closes it: the list inside scrolls on its own.
		window.addEventListener("resize", onClose);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("resize", onClose);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [onClose]);

	useEffect(() => {
		surface.current?.querySelector<HTMLElement>("button, input")?.focus();
	}, []);

	const sortOptions: { id: string; label: string; value: SortDirection | null }[] = [
		{ id: "asc", label: sortWords[0], value: "asc" },
		{ id: "desc", label: sortWords[1], value: "desc" },
		{ id: "none", label: "Recent activity", value: null },
	];

	return createPortal(
		<>
			<div
				data-popover-root
				className="fixed inset-0 z-[60]"
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}}
			/>
			<div
				ref={surface}
				role="dialog"
				aria-label={`${label} options`}
				className="fixed z-[61] flex w-[260px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] text-[length:var(--text-dense)] normal-case tracking-normal text-[var(--ink)]"
				style={{
					left: position?.left ?? 0,
					top: position?.top ?? 0,
					maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
					boxShadow: "var(--shadow-popover)",
					visibility: position ? "visible" : "hidden",
				}}
			>
				<div className="px-3 pb-1 pt-2 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]">
					Sort
				</div>
				<div role="radiogroup" aria-label={`Sort ${label}`} className="flex flex-col pb-1">
					{sortOptions.map((option) => {
						const chosen = direction === option.value;
						return (
							<button
								key={option.id}
								type="button"
								role="radio"
								aria-checked={chosen}
								onClick={() => onSort(option.value)}
								style={{ height: "var(--row-height)" }}
								className="flex w-full items-center gap-2.5 px-3 text-left hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
							>
								<span className="flex size-4 shrink-0 items-center justify-center text-[var(--accent)]">
									{chosen ? <Icon name="check" className="size-4" /> : null}
								</span>
								<span className="flex-1">{option.label}</span>
							</button>
						);
					})}
				</div>

				{children ? (
					<div className="flex min-h-0 flex-col border-t border-[var(--line)]">
						<div className="flex items-center justify-between px-3 pb-1 pt-2">
							<span className="text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]">
								Filter
							</span>
							{filtered && onClearFilter ? (
								<button
									type="button"
									onClick={onClearFilter}
									className="rounded-[var(--radius-sm)] px-1 text-[length:var(--text-sm)] text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
								>
									Clear
								</button>
							) : null}
						</div>
						<div className="min-h-0 overflow-y-auto pb-2">{children}</div>
					</div>
				) : null}
			</div>
		</>,
		document.body,
	);
}
