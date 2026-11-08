import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "./Kbd";

type TooltipProps = {
	label: string;
	/** The shortcut for what the trigger does, drawn beside the label. */
	keys?: string[];
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
/** The closest a label comes to the edge of the window. */
const MARGIN = 8;

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
export function Tooltip({ label, keys, side = "right", className = "flex", children }: TooltipProps) {
	const anchor = useRef<HTMLSpanElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const bubble = useRef<HTMLSpanElement>(null);
	const [spot, setSpot] = useState<Spot | null>(null);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	// A label under a trigger at the edge of the window (Search, top left) would
	// be centred half outside it. Measured before paint and pushed back inside,
	// so it is never drawn clipped and then moved.
	useLayoutEffect(() => {
		const element = bubble.current;
		if (!spot || !element) return;
		const width = element.offsetWidth;
		const wanted = side === "bottom" ? spot.x - width / 2 : spot.x;
		const room = window.innerWidth - width - MARGIN;
		element.style.left = `${Math.max(MARGIN, Math.min(wanted, room))}px`;
	}, [spot, side]);

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
							ref={bubble}
							aria-hidden
							style={{ left: spot.x, top: spot.y }}
							className={[
								"animate-pop pointer-events-none fixed z-[70] inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--ink)] px-2 py-1 text-sm text-[var(--surface)] shadow-[var(--shadow-popover)]",
								side === "right" ? "-translate-y-1/2" : "",
							].join(" ")}
						>
							{label}
							{keys ? <Kbd keys={keys} tone="inverse" /> : null}
						</span>,
						document.body,
					)
				: null}
		</span>
	);
}
