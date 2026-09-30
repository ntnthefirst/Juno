import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { ContextMenu, type MenuItem } from "./Menu";

type SplitButtonProps = {
	label: string;
	onClick: () => void;
	/** The other ways to do the same thing, behind the chevron. */
	items: MenuItem[];
	/** Spoken name of the chevron: "More ways to sign". */
	menuLabel: string;
	disabled?: boolean;
};

/**
 * A primary action with its variants beside it. The main part does the usual
 * thing in one press, and the chevron opens the less usual ones, so the common
 * case costs nothing and the rare one is still one click away.
 */
export function SplitButton({ label, onClick, items, menuLabel, disabled = false }: SplitButtonProps) {
	const chevron = useRef<HTMLButtonElement>(null);
	const [at, setAt] = useState<{ x: number; y: number } | null>(null);

	function open() {
		const box = chevron.current?.getBoundingClientRect();
		// Hung above the button, right edges aligned: a split button lives in a
		// page footer, where below is the edge of the window.
		if (box) setAt({ x: box.right, y: box.top - 4 });
	}

	const part =
		"inline-flex h-[40px] shrink-0 items-center justify-center bg-[var(--accent)] font-[var(--weight-medium)] text-[length:var(--text-base)] text-[var(--accent-ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]";

	return (
		<div className="inline-flex">
			<button type="button" disabled={disabled} onClick={onClick} className={`${part} rounded-l-[var(--radius-md)] px-4`}>
				{label}
			</button>
			<button
				ref={chevron}
				type="button"
				disabled={disabled}
				aria-label={menuLabel}
				aria-haspopup="menu"
				aria-expanded={at !== null}
				title={menuLabel}
				onClick={() => (at ? setAt(null) : open())}
				className={`${part} w-[36px] rounded-r-[var(--radius-md)] border-l border-[var(--accent-ink)]/25`}
			>
				<Icon name="chevron-down" size={16} />
			</button>
			{at ? (
				<ContextMenu
					at={at}
					items={items}
					onClose={() => {
						setAt(null);
						chevron.current?.focus();
					}}
					ariaLabel={menuLabel}
					anchor="bottom-right"
				/>
			) : null}
		</div>
	);
}
