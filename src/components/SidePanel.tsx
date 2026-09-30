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

/** What a press can land on without counting as outside the panel. */
const OUTSIDE_CLICK_IGNORE =
	"[role='menu'], [role='dialog'], [role='listbox'], [data-popover-root], [data-opens-panel]";

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
 * shape from a modal, and clicking anywhere on the screen the panel is not
 * covering closes it, the same way Escape does.
 *
 * Two kinds of click do not count as "the screen", because closing on either
 * would fight the reason this shape exists:
 *
 * - A row, an "Add" button or an "Edit" button that opens this same panel on a
 *   different item swaps what it shows instead of closing it and reopening a
 *   moment later. This component has no way to know which elements elsewhere
 *   on a screen do that, so it does not try to guess: they mark themselves
 *   with `data-opens-panel`, and the outside check leaves a press there alone.
 * - Something the screen, or the panel itself, opened on top of everything,
 *   such as a menu, a dialog or another popover. Those render through a
 *   portal, so they are not a descendant of this panel in the tree even
 *   though they float above it, and are found instead by `role="menu"`,
 *   `role="dialog"`, `role="listbox"` or a `data-popover-root` a popover adds
 *   to its own outermost element. A confirmation dialog opened from a button
 *   inside this panel is one of those: it must not close the panel it is
 *   asking about.
 *
 * The check runs on the press, not the release, so a text selection that
 * starts inside the panel and is dragged past its edge before the mouse comes
 * up does not close it.
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

	// Escape closes it, and calls the exact same `onClose` a click outside
	// does below, so a panel that one day guards a close behind an unsaved
	// edits question is asked it either way rather than only on one path.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	// A mousedown outside the panel closes it. See the doc comment above for
	// what does not count as outside and why the press decides rather than
	// the click. Focus is not trapped: the screen behind stays usable.
	useEffect(() => {
		function onPointerDown(event: MouseEvent) {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (panel.current?.contains(target)) return;
			if (target.closest(OUTSIDE_CLICK_IGNORE)) return;
			onClose();
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
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
