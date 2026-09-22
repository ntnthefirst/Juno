import { useEffect, useRef, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

type SidePanelProps = {
	title: string;
	/** Under the title, in one short line. The kind of thing this is. */
	subtitle?: string;
	onClose: () => void;
	/** Buttons along the bottom edge. */
	actions?: ReactNode;
	children: ReactNode;
};

/**
 * A panel that opens along the right edge and leaves the screen behind it
 * working.
 *
 * This is the shape for looking at one row of something you are still browsing.
 * A modal would be wrong here twice over: it hides the grid the item was
 * clicked in, which is the context that makes it mean anything, and it has to
 * be dismissed before the next item can be clicked, which turns reading down a
 * week into open, read, close, open, read, close.
 *
 * Settings is a modal window for the opposite reason, and the difference is
 * worth keeping straight: settings changes the shape of what the rest of the
 * application is showing, so work behind it has to stop. Reading an appointment
 * changes nothing.
 */
export function SidePanel({ title, subtitle, onClose, actions, children }: SidePanelProps) {
	const panel = useRef<HTMLElement>(null);

	// Escape closes it. Focus is not trapped and the click-away is not blocked:
	// the point of this panel is that the screen behind it stays usable.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	// Focus moves in so a keyboard reaches the panel's own controls next, rather
	// than continuing through the calendar behind it.
	useEffect(() => {
		panel.current?.focus();
	}, []);

	return (
		<aside
			ref={panel}
			tabIndex={-1}
			aria-label={title}
			className="flex w-[360px] flex-none flex-col border-l border-[var(--line)] bg-[var(--paper)] focus:outline-none"
		>
			<div className="flex flex-none items-start gap-2 border-b border-[var(--line)] px-4 py-3">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-[length:var(--text-base)] font-[var(--weight-semibold)]">
						{title}
					</h2>
					{subtitle ? (
						<p className="mt-0.5 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{subtitle}
						</p>
					) : null}
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					title="Close"
					className="-mr-1 flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<XMarkIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

			{actions ? (
				<div className="flex flex-none items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
					{actions}
				</div>
			) : null}
		</aside>
	);
}
