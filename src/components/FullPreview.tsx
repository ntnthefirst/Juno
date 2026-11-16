import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useContentHost } from "../lib/content-host";
import { Icon } from "./Icon";
import { IconAction } from "./IconAction";
import { Tooltip } from "./Tooltip";

type FullPreviewProps = {
	/** The file's name. The heading, and the region's accessible name. */
	title: string;
	/** Drawn left of the name: the file's type icon. */
	icon?: ReactNode;
	/** Drawn instead of the name, for a name being edited in place. */
	heading?: ReactNode;
	/** One line under the name: its type, size and date. */
	meta?: ReactNode;
	/** Drawn after the name: Specimen, Not the latest. */
	badges?: ReactNode;
	/** Where this file sits among the others of the list it was opened from. Null when it is the only one. */
	position?: { index: number; total: number; onPrevious: () => void; onNext: () => void } | null;
	/** The file's own actions, at the right of the header. */
	actions?: ReactNode;
	/** The column at the right: details, versions, a form. Left out, there is none. */
	column?: ReactNode;
	columnOpen?: boolean;
	onToggleColumn?: () => void;
	/** What the way back says, "Back to Contracts". */
	closeLabel?: string;
	onClose: () => void;
	/** The file itself. */
	children: ReactNode;
};

/** A key pressed in one of these is the field's, not the preview's. */
function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
	);
}

/**
 * A file shown over the whole content area: the name and what it is at the
 * top, Previous and Next through the list it came from, its actions, the file
 * in the middle and a column of details at the right that can be put away.
 *
 * It covers the sheet a screen is drawn on and nothing else, so the rail and
 * the title bar stay usable, and it is not a window: Escape closes it, and the
 * arrow keys go to the file before or after unless a field has the focus.
 * Focus moves in when it opens and back to whatever opened it when it closes,
 * so a list that opened it on Space carries on where it was.
 */
export function FullPreview({
	title,
	icon,
	heading,
	meta,
	badges,
	position,
	actions,
	column,
	columnOpen = true,
	onToggleColumn,
	closeLabel = "Close the preview",
	onClose,
	children,
}: FullPreviewProps) {
	const host = useContentHost();
	const frame = useRef<HTMLDivElement>(null);
	const latest = useRef({ onClose, position });
	useEffect(() => {
		latest.current = { onClose, position };
	});

	useEffect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		frame.current?.focus({ preventScroll: true });
		return () => {
			if (opener?.isConnected) opener.focus({ preventScroll: true });
		};
	}, []);

	// Next on the last file is disabled under the focus, and a button the next file does not
	// have goes with the last one; either drops the focus on the page, so it comes back here.
	const at = position?.index ?? null;
	useEffect(() => {
		const active = document.activeElement;
		if (active === null || active === document.body) frame.current?.focus({ preventScroll: true });
	}, [at, title]);

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented) return;
			// A question on top answers its own keys first, and so does adding a
			// file from the preview, which covers it.
			if (document.querySelector("[role='dialog'], [data-add-files]")) return;
			if (event.key === "Escape") {
				if (isTyping(event.target)) return;
				event.preventDefault();
				// Text selected in the file goes first, so a second Escape is what closes.
				const selection = window.getSelection();
				if (selection && !selection.isCollapsed && frame.current?.contains(selection.anchorNode)) {
					selection.removeAllRanges();
					return;
				}
				latest.current.onClose();
				return;
			}
			if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
			const at = latest.current.position;
			if (!at) return;
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				at.onPrevious();
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				at.onNext();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const body = (
		<div
			ref={frame}
			tabIndex={-1}
			role="region"
			aria-label={`Preview of ${title}`}
			data-full-preview
			className="animate-scale absolute inset-0 z-30 flex flex-col bg-[var(--surface)] focus:outline-none"
		>
			<div className="flex h-[56px] flex-none items-center gap-2 border-b border-[var(--line)] px-3">
				<IconAction icon="close" label={closeLabel} tooltip="bottom" onClick={onClose} />
				{icon ? <span className="flex flex-none items-center">{icon}</span> : null}
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						{heading ?? (
							<h2 data-selectable className="min-w-0 truncate text-base font-[var(--weight-medium)]" title={title}>
								{title}
							</h2>
						)}
						{badges}
					</div>
					{meta ? <p className="tabular truncate text-sm text-[var(--ink-muted)]">{meta}</p> : null}
				</div>
				{position && position.total > 1 ? (
					<div className="flex flex-none items-center gap-2">
						<IconAction
							icon="chevron-left"
							label="Previous file"
							tooltip="bottom"
							disabled={position.index <= 0}
							onClick={position.onPrevious}
						/>
						<span aria-live="polite" className="tabular min-w-[34px] text-center text-sm text-[var(--ink-muted)]">
							{position.index + 1} of {position.total}
						</span>
						<IconAction
							icon="chevron-right"
							label="Next file"
							tooltip="bottom"
							disabled={position.index >= position.total - 1}
							onClick={position.onNext}
						/>
					</div>
				) : null}
				{actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
				{column && onToggleColumn ? (
					<Tooltip label={columnOpen ? "Hide details" : "Show details"} side="bottom">
						<button
							type="button"
							aria-label={columnOpen ? "Hide details" : "Show details"}
							aria-pressed={columnOpen}
							onClick={onToggleColumn}
							className={`inline-flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-md)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
								columnOpen ? "bg-[var(--hover)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
							}`}
						>
							<Icon name="panel" size={16} />
						</button>
					</Tooltip>
				) : null}
			</div>
			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">{children}</div>
				{column && columnOpen ? (
					<aside
						aria-label="Details"
						className="animate-fade flex w-[380px] flex-none flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)]"
					>
						{column}
					</aside>
				) : null}
			</div>
		</div>
	);

	return host ? createPortal(body, host) : body;
}
