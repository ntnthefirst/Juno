import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TitleMenuProps = {
	/** The corner under the button the menu hangs from. */
	at: { x: number; y: number };
	/** The menu's accessible name, "Reminders". */
	label: string;
	width: number;
	/** The way to the full screen, drawn under a rule at the foot. */
	footer: { label: string; onSelect: () => void };
	onClose: () => void;
	children: ReactNode;
};

/**
 * A dropdown that hangs from a title bar button: Reminders and the agent, the
 * same surface Recent uses. It closes on a click outside, on Escape and on Tab,
 * and is held inside the window however close to the edge its button is.
 */
export function TitleMenu({ at, label, width, footer, onClose, children }: TitleMenuProps) {
	const surface = useRef<HTMLDivElement>(null);
	// The width is fixed, so the menu is held inside the window without measuring it.
	const left = Math.max(8, Math.min(at.x, window.innerWidth - 8 - width));

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			} else if (event.key === "Tab" && !surface.current?.contains(document.activeElement)) {
				onClose();
			}
		}
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

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
				data-palette
				aria-label={label}
				className="animate-scale fixed z-[61] flex max-h-[min(560px,calc(100vh-64px))] flex-col rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-1.5"
				style={{ left, top: at.y, width, boxShadow: "var(--shadow-popover)" }}
			>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
				<div className="mt-1 border-t border-[var(--line)] pt-1">
					<button
						type="button"
						onClick={() => {
							onClose();
							footer.onSelect();
						}}
						className="w-full rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-dense text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						{footer.label}
					</button>
				</div>
			</div>
		</>,
		document.body,
	);
}

type TitleMenuHeadingProps = { children: ReactNode };

/** A group's name inside a title bar menu: Overdue, Waiting for you, Lately. */
export function TitleMenuHeading({ children }: TitleMenuHeadingProps) {
	return <p className="px-2.5 pt-2 pb-1 text-overline uppercase text-[var(--ink-muted)]">{children}</p>;
}
