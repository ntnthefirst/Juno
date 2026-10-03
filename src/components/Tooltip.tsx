import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipProps = {
	label: string;
	/** Which side of the trigger the label sits on. */
	side?: "right" | "bottom";
	/** Classes for the element wrapping the trigger, which the label is measured from. */
	className?: string;
	children: ReactNode;
};

type Spot = { x: number; y: number };

/** How long the pointer rests before the label appears. */
const SHOW_DELAY = 350;
/** Moving from one trigger to the next inside this window skips the delay. */
const WARM_WINDOW = 400;
const GAP = 10;

// Shared across every tooltip, so sweeping the pointer down a column of icons
// shows each label at once instead of waiting out the delay on every one.
let lastHiddenAt = 0;

/**
 * A label that follows the trigger it names, drawn by the application rather
 * than the platform. The native `title` tooltip cannot be styled, waits about a
 * second, and is clipped inside a scrolling column, which is where the sidebar
 * keeps its icons.
 *
 * The trigger keeps its own `aria-label`: this label is for the pointer and is
 * hidden from assistive technology so the name is not read twice.
 *
 * It closes on press as well as on leave, so the label does not hang over the
 * screen the click just opened.
 */
export function Tooltip({ label, side = "right", className = "flex", children }: TooltipProps) {
	const anchor = useRef<HTMLSpanElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const [spot, setSpot] = useState<Spot | null>(null);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	function reveal() {
		const element = anchor.current;
		if (!element) return;
		const rect = element.getBoundingClientRect();
		setSpot(
			side === "right"
				? { x: rect.right + GAP, y: rect.top + rect.height / 2 }
				: { x: rect.left + rect.width / 2, y: rect.bottom + GAP },
		);
	}

	function show() {
		window.clearTimeout(timer.current);
		if (Date.now() - lastHiddenAt < WARM_WINDOW) {
			reveal();
			return;
		}
		timer.current = window.setTimeout(reveal, SHOW_DELAY);
	}

	function hide() {
		window.clearTimeout(timer.current);
		if (spot) lastHiddenAt = Date.now();
		setSpot(null);
	}

	return (
		<span
			ref={anchor}
			className={className}
			onPointerEnter={show}
			onPointerLeave={hide}
			onPointerDown={hide}
			onFocus={show}
			onBlur={hide}
		>
			{children}
			{spot
				? createPortal(
						<span
							aria-hidden
							style={{ left: spot.x, top: spot.y }}
							className={[
								"animate-pop pointer-events-none fixed z-[70] whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--ink)] px-2 py-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--paper)] shadow-[var(--shadow-popover)]",
								side === "right" ? "-translate-y-1/2" : "-translate-x-1/2",
							].join(" ")}
						>
							{label}
						</span>,
						document.body,
					)
				: null}
		</span>
	);
}
