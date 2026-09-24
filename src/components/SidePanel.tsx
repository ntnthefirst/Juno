import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

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
 * A panel that opens over the right edge and leaves the screen behind it
 * working.
 *
 * This is the shape for looking at one row of something you are still browsing.
 * A modal would be wrong here twice over: it hides the grid the item was
 * clicked in, which is the context that makes it mean anything, and it has to
 * be dismissed before the next item can be clicked, which turns reading down a
 * week into open, read, close, open, read, close.
 *
 * It floats rather than taking a column of its own. The content behind is
 * softened by a hair and the panel casts a shadow to its left, so it reads as
 * something laid on top of the screen rather than a third pane that appeared
 * and squeezed the other two. The softening layer takes no pointer events: the
 * grid underneath stays clickable, which is the one thing that separates this
 * shape from a modal, and clicking another row simply swaps what the panel is
 * showing.
 *
 * Settings is a modal window for the opposite reason, and the difference is
 * worth keeping straight: settings changes the shape of what the rest of the
 * application is showing, so work behind it has to stop. Reading an appointment
 * changes nothing.
 *
 * The element this is rendered inside has to be `relative`, because the panel
 * and its softening layer are positioned against it. That is deliberate: the
 * blur belongs to the screen that opened the panel, not to the whole window,
 * so the sidebar and the title bar stay sharp.
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
	// than continuing through the screen behind it.
	useEffect(() => {
		panel.current?.focus();
	}, []);

	return (
		<>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 z-20 bg-[var(--ink)]/[0.04]"
				style={{ backdropFilter: "blur(var(--overlay-blur))" }}
			/>
			<aside
				ref={panel}
				tabIndex={-1}
				aria-label={title}
				className="absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-full flex-col border-l border-[var(--line)] bg-[var(--paper)] focus:outline-none"
				style={{ boxShadow: "var(--shadow-panel)" }}
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
						<Icon name="close" />
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

				{actions ? (
					<div className="flex flex-none items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
						{actions}
					</div>
				) : null}
			</aside>
		</>
	);
}
