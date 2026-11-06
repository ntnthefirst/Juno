import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

type FindBarProps = {
	query: string;
	onQueryChange: (query: string) => void;
	/** How many matches there are. */
	count: number;
	/** The current one, counted from zero, or -1 when there is none. */
	current: number;
	onNext: () => void;
	onPrevious: () => void;
	onClose: () => void;
};

/**
 * The find bar a reader or an editor shows at its top right. It holds no text
 * of its own to search: the screen that mounts it does the finding and hands
 * back the count, so the same bar serves a message in a frame and a page.
 * Enter goes to the next match, Shift+Enter to the previous, Escape closes.
 */
export function FindBar({ query, onQueryChange, count, current, onNext, onPrevious, onClose }: FindBarProps) {
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (event.shiftKey) onPrevious();
			else onNext();
		}
	}

	const label = query === "" ? "" : count === 0 ? "No matches" : `${current + 1} of ${count}`;

	return (
		<div
			role="search"
			className="animate-pop flex h-10 w-[292px] items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] pr-1 pl-3 shadow-[var(--shadow-popover)]"
		>
			<Icon name="search" size={16} className="flex-none text-[var(--ink-muted)]" />
			<input
				ref={input}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={onKeyDown}
				aria-label="Find in this message"
				placeholder="Find"
				className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--ink-faint)]"
			/>
			<span aria-live="polite" className="tabular flex-none text-dense text-[var(--ink-muted)]">
				{label}
			</span>
			<button
				type="button"
				aria-label="Previous match"
				disabled={count === 0}
				onClick={onPrevious}
				className="flex size-8 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
			>
				<Icon name="chevron-left" size={16} />
			</button>
			<button
				type="button"
				aria-label="Next match"
				disabled={count === 0}
				onClick={onNext}
				className="flex size-8 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
			>
				<Icon name="chevron-right" size={16} />
			</button>
			<button
				type="button"
				aria-label="Close find"
				onClick={onClose}
				className="flex size-8 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
			>
				<Icon name="close" size={16} />
			</button>
		</div>
	);
}
