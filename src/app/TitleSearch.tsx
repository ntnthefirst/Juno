import { useEffect, useRef } from "react";
import { Icon } from "../components/Icon";
import { COMBOS, formatCombo, matchesCombo } from "../lib/shortcuts";
import { TitleBarSlot } from "./TitleBarSlot";

type TitleSearchProps = {
	value: string;
	onChange: (value: string) => void;
	/** "Search clients". Also the field's accessible name. */
	placeholder: string;
};

/**
 * A list screen's search, in the title bar before New (the Title Search
 * component in the design). It filters the list on show, so it lives as long
 * as the list does and goes when a record replaces it.
 *
 * Ctrl F puts the cursor in it. A message or a page that is open finds inside
 * itself with the same keys; those listen on the document, which hears the key
 * before the window does, and mark the event handled, so this one stands back.
 * Escape empties the field, and a second Escape leaves it.
 */
export function TitleSearch({ value, onChange, placeholder }: TitleSearchProps) {
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || !matchesCombo(event, COMBOS.find)) return;
			if (document.querySelector("[role='dialog']")) return;
			event.preventDefault();
			input.current?.focus();
			input.current?.select();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<TitleBarSlot side="right">
			<label className="flex h-7 w-[240px] items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] pr-2 pl-2.5 text-[var(--ink-faint)] transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease)] focus-within:border-[var(--focus)] focus-within:bg-[var(--surface)]">
				<Icon name="search" size={14} className="flex-none" />
				<input
					ref={input}
					type="search"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						if (value) onChange("");
						else input.current?.blur();
					}}
					placeholder={placeholder}
					aria-label={placeholder}
					className="min-w-0 flex-1 bg-transparent text-dense text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] [&::-webkit-search-cancel-button]:hidden"
				/>
				{value ? (
					<button
						type="button"
						aria-label="Clear search"
						onClick={() => {
							onChange("");
							input.current?.focus();
						}}
						className="-mr-1 flex h-5 w-5 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<Icon name="close" size={12} />
					</button>
				) : (
					<kbd className="flex-none font-sans text-micro text-[var(--ink-faint)]">{formatCombo(COMBOS.find).join(" ")}</kbd>
				)}
			</label>
		</TitleBarSlot>
	);
}
