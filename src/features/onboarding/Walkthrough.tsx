import { useEffect, useId, useRef, useState } from "react";
import type { ScreenId } from "../../app/screens";
import { Button } from "../../components/Button";

type WalkthroughStop = {
	id: string;
	title: string;
	body: string;
	/**
	 * The screen to bring up behind the card, when there is one. Left out for a
	 * stop that points at something outside the screen switch, such as the
	 * sidebar footer.
	 */
	screen?: ScreenId;
	/**
	 * A CSS selector on a stable attribute, never on displayed text: `data-nav`
	 * and `aria-label` already exist on the elements below and are unaffected
	 * by a collapsed sidebar or a locale change. When nothing on screen matches
	 * it, the stop falls back to a centred card with no cutout rather than
	 * throwing, which is what happens today for "Agent": there is no sidebar
	 * entry for it yet (screens.ts has no "agent" ScreenId), and that file
	 * belongs to other work.
	 */
	target: string;
};

const STOPS: WalkthroughStop[] = [
	{
		id: "today",
		title: "Today",
		body: "Gathers what needs you: reminders due, mail waiting, appointments coming up.",
		screen: "today",
		target: '[data-nav="today"]',
	},
	{
		id: "clients",
		title: "Clients",
		body: "Every business you work with, their contacts and the documents tied to them.",
		screen: "clients",
		target: '[data-nav="clients"]',
	},
	{
		id: "documents",
		title: "Documents",
		body: "What you have generated or imported for a client, and whether it is signed.",
		screen: "documents",
		target: '[data-nav="documents"]',
	},
	{
		id: "document-templates",
		title: "Document templates",
		body: "The contracts and letters your documents are generated from.",
		screen: "document-templates",
		target: '[data-nav="document-templates"]',
	},
	{
		id: "mail",
		title: "Mail",
		body: "Reads your IMAP accounts from here. Nothing leaves this machine unless you send it.",
		screen: "mail",
		target: '[data-nav="mail"]',
	},
	{
		id: "templates",
		title: "Mail templates",
		body: "The emails you send to clients again and again.",
		screen: "templates",
		target: '[data-nav="templates"]',
	},
	{
		id: "calendar",
		title: "Calendar",
		body: "Your appointments, and the dates tied to a project.",
		screen: "calendar",
		target: '[data-nav="calendar"]',
	},
	{
		id: "reminders",
		title: "Reminders",
		body: "This bell shows what is due, from any screen. Open it for the full list.",
		screen: "reminders",
		target: '[aria-label="Show reminders"]',
	},
	{
		id: "agent",
		title: "Agent",
		body: "An agent can read and act on Juno over the same connection. Anything it sends, signs or deletes waits for your approval first. Connect one from settings, under MCP.",
		target: '[data-tour="agent"]',
	},
	{
		id: "settings",
		title: "Settings",
		body: "Your business details, mail accounts, appearance and the lock. It opens in its own window.",
		target: '[data-nav="settings"]',
	},
];

const CARD_WIDTH = 320;
const CARD_MIN_HEIGHT = 150;
/** Matches --space-2: the ring around a spotlighted control, not tight against it. */
const CUTOUT_PADDING = 8;
/** Matches --space-3: the gap between the ring and the card beside it. */
const CARD_GAP = 12;
/** Matches --space-4: how close the card is allowed to sit to the window edge. */
const VIEWPORT_MARGIN = 16;

type Rect = { top: number; left: number; width: number; height: number };

type Placement = {
	cutout: Rect | null;
	card: { top: number; left: number };
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

function computePlacement(target: DOMRect | null, cardWidth: number, cardHeight: number): Placement {
	const vw = window.innerWidth;
	const vh = window.innerHeight;

	if (!target || (target.width === 0 && target.height === 0)) {
		return {
			cutout: null,
			card: {
				top: clamp((vh - cardHeight) / 2, VIEWPORT_MARGIN, vh - cardHeight - VIEWPORT_MARGIN),
				left: clamp((vw - cardWidth) / 2, VIEWPORT_MARGIN, vw - cardWidth - VIEWPORT_MARGIN),
			},
		};
	}

	const cutout: Rect = {
		top: target.top - CUTOUT_PADDING,
		left: target.left - CUTOUT_PADDING,
		width: target.width + CUTOUT_PADDING * 2,
		height: target.height + CUTOUT_PADDING * 2,
	};

	const spaceRight = vw - (cutout.left + cutout.width);
	const spaceLeft = cutout.left;
	const spaceBelow = vh - (cutout.top + cutout.height);
	const spaceAbove = cutout.top;

	let top: number;
	let left: number;

	if (spaceRight >= cardWidth + CARD_GAP) {
		left = cutout.left + cutout.width + CARD_GAP;
		top = cutout.top;
	} else if (spaceLeft >= cardWidth + CARD_GAP) {
		left = cutout.left - CARD_GAP - cardWidth;
		top = cutout.top;
	} else if (spaceBelow >= cardHeight + CARD_GAP) {
		left = cutout.left;
		top = cutout.top + cutout.height + CARD_GAP;
	} else if (spaceAbove >= cardHeight + CARD_GAP) {
		left = cutout.left;
		top = cutout.top - CARD_GAP - cardHeight;
	} else {
		// Nowhere clean fits: land it under the target and let the clamp below
		// keep the whole card on screen even so.
		left = cutout.left;
		top = cutout.top + cutout.height + CARD_GAP;
	}

	return {
		cutout,
		card: {
			top: clamp(top, VIEWPORT_MARGIN, vh - cardHeight - VIEWPORT_MARGIN),
			left: clamp(left, VIEWPORT_MARGIN, vw - cardWidth - VIEWPORT_MARGIN),
		},
	};
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function samePlacement(a: Placement, b: Placement): boolean {
	return (
		sameRect(a.cutout, b.cutout) && a.card.top === b.card.top && a.card.left === b.card.left
	);
}

const FOCUSABLE = "a[href], button:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

type WalkthroughProps = {
	/** Drives the real screen behind the card. The tour is not a slideshow of it. */
	onNavigate: (screen: ScreenId) => void;
	/** Called after `walkthroughSeenAt` is written, whether finished or closed early. */
	onClose: () => void;
};

/**
 * A guided tour over the running shell, not a recording of one. Each stop
 * dims the window, cuts a hole over the control it is talking about, and
 * drives the app to the screen that control opens, so the card is always
 * describing something real underneath it rather than a picture of it.
 *
 * Built as a trapping dialog rather than an untrapped region: the tour is
 * driving navigation itself, there is nothing useful to do in the dimmed
 * app behind it while a stop is showing, and a single focus target (the
 * card) is easier to keep correct than co-operating with whatever the
 * current screen happens to put in the tab order.
 */
export function Walkthrough({ onNavigate, onClose }: WalkthroughProps) {
	const [index, setIndex] = useState(0);
	const [layout, setLayout] = useState<Placement>(() => computePlacement(null, CARD_WIDTH, CARD_MIN_HEIGHT));
	const cardRef = useRef<HTMLDivElement>(null);
	const headingId = useId();

	const stop = STOPS[index];
	const isLast = index === STOPS.length - 1;

	// Read through a ref rather than listed as a dependency: onNavigate may be a
	// fresh closure on every render of the shell, and the thing that should
	// actually retrigger this effect is the stop changing, not that.
	const onNavigateRef = useRef(onNavigate);
	useEffect(() => {
		onNavigateRef.current = onNavigate;
	});

	useEffect(() => {
		if (stop.screen) onNavigateRef.current(stop.screen);
	}, [stop.screen]);

	// Re-measured every frame rather than once: right after a navigate the
	// screen underneath may not have mounted its target yet, the sidebar can
	// collapse mid-tour, and the window can resize. One loop catches all three
	// without three separate listeners, and it is cheap: a handful of elements,
	// only while the tour is open.
	useEffect(() => {
		let frame = 0;
		function tick() {
			const el = document.querySelector<HTMLElement>(stop.target);
			const targetRect = el ? el.getBoundingClientRect() : null;
			const cardWidth = cardRef.current?.offsetWidth ?? CARD_WIDTH;
			const cardHeight = cardRef.current?.offsetHeight ?? CARD_MIN_HEIGHT;
			const next = computePlacement(targetRect, cardWidth, cardHeight);
			setLayout((current) => (samePlacement(current, next) ? current : next));
			frame = requestAnimationFrame(tick);
		}
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [stop.target]);

	useEffect(() => {
		cardRef.current?.focus();
	}, [index]);

	async function markSeen() {
		try {
			await window.juno.settings.setOnboarding({ walkthroughSeenAt: new Date().toISOString() });
		} finally {
			onClose();
		}
	}

	function back() {
		setIndex((current) => Math.max(0, current - 1));
	}

	function next() {
		if (isLast) {
			void markSeen();
			return;
		}
		setIndex((current) => Math.min(STOPS.length - 1, current + 1));
	}

	// Same ref pattern as above: the handlers close over `index` and `isLast`,
	// and re-reading them through a ref means the listener itself can be
	// attached once rather than torn down and rebuilt on every step.
	const stepHandlers = useRef({ next, back, markSeen });
	useEffect(() => {
		stepHandlers.current = { next, back, markSeen };
	});

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				void stepHandlers.current.markSeen();
				return;
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				stepHandlers.current.next();
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				stepHandlers.current.back();
				return;
			}
			if (event.key !== "Tab") return;

			const node = cardRef.current;
			if (!node) return;
			const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			const outside = !(active instanceof Node) || !node.contains(active);

			if (event.shiftKey && (active === first || outside)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || outside)) {
				event.preventDefault();
				first.focus();
			}
		}
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, []);

	return (
		<div className="fixed inset-0 z-[70]">
			{layout.cutout === null ? (
				<div className="absolute inset-0 bg-[var(--ink)]/70" />
			) : (
				<>
					<div
						aria-hidden
						className="absolute bg-[var(--ink)]/70"
						style={{ top: 0, left: 0, right: 0, height: Math.max(0, layout.cutout.top) }}
					/>
					<div
						aria-hidden
						className="absolute bg-[var(--ink)]/70"
						style={{ top: layout.cutout.top + layout.cutout.height, left: 0, right: 0, bottom: 0 }}
					/>
					<div
						aria-hidden
						className="absolute bg-[var(--ink)]/70"
						style={{
							top: layout.cutout.top,
							left: 0,
							width: Math.max(0, layout.cutout.left),
							height: layout.cutout.height,
						}}
					/>
					<div
						aria-hidden
						className="absolute bg-[var(--ink)]/70"
						style={{
							top: layout.cutout.top,
							left: layout.cutout.left + layout.cutout.width,
							right: 0,
							height: layout.cutout.height,
						}}
					/>
					<div
						aria-hidden
						className="pointer-events-none absolute rounded-[var(--radius-md)] shadow-[0_0_0_2px_var(--accent)]"
						style={{
							top: layout.cutout.top,
							left: layout.cutout.left,
							width: layout.cutout.width,
							height: layout.cutout.height,
						}}
					/>
				</>
			)}

			<div
				ref={cardRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				tabIndex={-1}
				className="absolute top-0 left-0 w-[320px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4 outline-none transition-transform duration-[var(--duration-base)] ease-[var(--ease)]"
				style={{
					transform: `translate(${layout.card.left}px, ${layout.card.top}px)`,
					boxShadow: "var(--shadow-popover)",
				}}
			>
				<h2 id={headingId} className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">
					{stop.title}
				</h2>
				<p className="mt-2 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-[var(--ink-muted)]">
					{stop.body}
				</p>
				<div className="mt-4 flex items-center justify-between gap-3">
					<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-faint)]">
						Step {index + 1} of {STOPS.length}
					</span>
					<div className="flex items-center gap-2">
						<Button onClick={() => void markSeen()}>Close the walkthrough</Button>
						<Button onClick={back} disabled={index === 0}>
							Back
						</Button>
						<Button variant="primary" onClick={next}>
							{isLast ? "Finish" : "Next"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
