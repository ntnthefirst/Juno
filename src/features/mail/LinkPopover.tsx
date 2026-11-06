import { createPortal } from "react-dom";
import { isHttpsLink } from "@shared/mail-link";

type LinkPopoverProps = {
	href: string;
	/** Window coordinates of the point the popover hangs from: the link's bottom left. */
	x: number;
	y: number;
	onOpen: (href: string) => void;
	onCopy: (href: string) => void;
	/** The pointer is over the popover, so it stays. */
	onEnter: () => void;
	onLeave: () => void;
};

const WIDTH = 300;

/**
 * The real address behind a link in a message, under the link. The text of an
 * anchor says nothing about where it goes, so this is the address itself. A
 * link that is not https cannot be opened from here: the button is gone, not
 * greyed, and the address can still be copied.
 */
export function LinkPopover({ href, x, y, onOpen, onCopy, onEnter, onLeave }: LinkPopoverProps) {
	const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
	const canOpen = isHttpsLink(href);

	return createPortal(
		<div
			role="group"
			aria-label="Link address"
			onMouseEnter={onEnter}
			onMouseLeave={onLeave}
			className="animate-pop fixed z-50 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-3 pt-2 pb-1 shadow-[var(--shadow-popover)]"
			style={{ left, top: y, width: WIDTH }}
		>
			<p className="text-overline uppercase tracking-[0.06em] text-[var(--ink-muted)]">Goes to</p>
			<p data-selectable className="mt-1 break-all font-mono text-micro text-[var(--ink)]">
				{href}
			</p>
			<div className="mt-1 flex items-center gap-1">
				{canOpen ? (
					<button
						type="button"
						onClick={() => onOpen(href)}
						className="rounded-[var(--radius-sm)] px-2 py-1.5 text-dense text-[var(--ink)] hover:bg-[var(--hover)]"
					>
						Open in browser
					</button>
				) : null}
				<button
					type="button"
					onClick={() => onCopy(href)}
					className="rounded-[var(--radius-sm)] px-2 py-1.5 text-dense text-[var(--ink)] hover:bg-[var(--hover)]"
				>
					Copy link
				</button>
			</div>
		</div>,
		document.body,
	);
}
