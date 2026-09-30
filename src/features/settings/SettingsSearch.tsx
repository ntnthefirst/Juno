import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { searchSettings, TAB_LABELS, type SettingEntry } from "./search";

type SettingsSearchProps = {
	onPick: (entry: SettingEntry) => void;
};

/**
 * The search box in the settings title bar. It matches on the words in
 * `search.ts`, so "screensaver" finds the lock and "dark" finds the theme.
 *
 * Arrow keys move through the results, Enter opens one, and Escape clears the
 * box before it is allowed to close the window. Ctrl or Cmd plus F focuses it.
 */
export function SettingsSearch({ onPick }: SettingsSearchProps) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [open, setOpen] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const wrapper = useRef<HTMLDivElement>(null);
	const listId = useId();

	const results = useMemo(() => searchSettings(query), [query]);
	const showing = open && query.trim() !== "";

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
				event.preventDefault();
				input.current?.focus();
				input.current?.select();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (event.target instanceof Node && wrapper.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	function pick(entry: SettingEntry) {
		setOpen(false);
		onPick(entry);
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown" && results.length > 0) {
			event.preventDefault();
			setOpen(true);
			setActive((current) => (current + 1) % results.length);
		} else if (event.key === "ArrowUp" && results.length > 0) {
			event.preventDefault();
			setActive((current) => (current - 1 + results.length) % results.length);
		} else if (event.key === "Enter") {
			const entry = results[active];
			if (entry) {
				event.preventDefault();
				pick(entry);
			}
		} else if (event.key === "Escape") {
			// The window closes on Escape. While there is something to dismiss,
			// this press is for the search instead.
			if (query !== "" || open) {
				event.preventDefault();
				setQuery("");
				setOpen(false);
			}
		}
	}

	return (
		<div ref={wrapper} className="no-drag relative w-[280px]">
			<div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pr-1 pl-2 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
				<Icon name="search" size={14} />
				<input
					ref={input}
					type="search"
					role="combobox"
					aria-expanded={showing}
					aria-controls={listId}
					aria-label="Search settings"
					placeholder="Search settings"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={onKeyDown}
					className="min-w-0 flex-1 bg-transparent py-1 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
				/>
				{query ? (
					<button
						type="button"
						aria-label="Clear search"
						title="Clear search"
						onClick={() => {
							setQuery("");
							input.current?.focus();
						}}
						className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<Icon name="close" size={12} />
					</button>
				) : null}
			</div>

			{showing ? (
				<ul
					id={listId}
					role="listbox"
					aria-label="Matching settings"
					className="animate-pop absolute top-full right-0 left-0 z-20 mt-1 max-h-[360px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--shadow-popover)]"
				>
					{results.length === 0 ? (
						<li className="px-3 py-2 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
							No setting matches that. Try another word.
						</li>
					) : (
						results.map((entry, index) => (
							<li
								key={`${entry.anchor}:${entry.title}`}
								role="option"
								aria-selected={index === active}
							>
								<button
									type="button"
									tabIndex={-1}
									onMouseEnter={() => setActive(index)}
									onClick={() => pick(entry)}
									className={[
										"flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-left",
										index === active ? "bg-[var(--accent-soft)]" : "",
									].join(" ")}
								>
									<span className="flex items-baseline justify-between gap-3">
										<span className="truncate text-[length:var(--text-dense)] text-[var(--ink)]">
											{entry.title}
										</span>
										<span className="flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{TAB_LABELS[entry.tab]}
										</span>
									</span>
									<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{entry.description}
									</span>
								</button>
							</li>
						))
					)}
				</ul>
			) : null}
		</div>
	);
}
