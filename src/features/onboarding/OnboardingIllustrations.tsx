import "./onboarding-motion.css";

/**
 * One small drawn idea per setup step, built from strokes rather than shapes
 * lifted from anywhere else. Every animated path uses `pathLength={100}` so the
 * dash-based reveal in onboarding-motion.css works the same regardless of the
 * path's real length, and every colour is `currentColor` against a token set on
 * the wrapping element, never a hex value.
 *
 * Each one plays once, in under 1.2s, and settles. `onboarding-motion.css`
 * carries the `prefers-reduced-motion: reduce` override that renders the final
 * state outright.
 */

const SIZE = 96;

/** The crescent over the arc, the same mark TitleBar.tsx draws, drawing itself in. */
export function WelcomeIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			className="mx-auto text-[var(--accent)]"
			aria-hidden
		>
			<path d="M80 26a34 34 0 1 0 12 58 40 40 0 0 1-12-58Z" pathLength={100} className="onb-draw" />
			<path d="M24 96h72" pathLength={100} className="onb-draw onb-delay-2" />
		</svg>
	);
}

/** A signature, drawn the way a hand draws one, over its line. */
export function PersonIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="mx-auto text-[var(--accent)]"
			aria-hidden
		>
			<path
				d="M28 74c10-4 14-16 18-28 3-9 7-8 7 2 0 12-6 26-6 26s10-18 18-18 4 14 11 14c5 0 8-4 8-4"
				pathLength={100}
				className="onb-draw"
			/>
			<path d="M24 92h72" pathLength={100} className="onb-draw onb-delay-3 text-[var(--ink-muted)]" />
		</svg>
	);
}

/** A document outline, with its lines settling into place a beat after. */
export function BusinessIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="mx-auto text-[var(--accent)]"
			aria-hidden
		>
			<rect x="28" y="16" width="64" height="88" rx="6" pathLength={100} className="onb-draw" />
			<line x1="40" y1="40" x2="80" y2="40" className="onb-settle onb-delay-2 text-[var(--ink-muted)]" />
			<line x1="40" y1="54" x2="80" y2="54" className="onb-settle onb-delay-2 text-[var(--ink-muted)]" />
			<line x1="40" y1="68" x2="66" y2="68" className="onb-settle onb-delay-3 text-[var(--ink-muted)]" />
		</svg>
	);
}

/** A sun fading out as a crescent fades in over it: one setting, either way. */
export function AppearanceIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			className="mx-auto text-[var(--accent)]"
			aria-hidden
		>
			<g className="onb-fade-out">
				<circle cx="60" cy="60" r="16" />
				<line x1="60" y1="26" x2="60" y2="16" />
				<line x1="60" y1="94" x2="60" y2="104" />
				<line x1="26" y1="60" x2="16" y2="60" />
				<line x1="94" y1="60" x2="104" y2="60" />
				<line x1="37" y1="37" x2="30" y2="30" />
				<line x1="83" y1="83" x2="90" y2="90" />
				<line x1="83" y1="37" x2="90" y2="30" />
				<line x1="37" y1="83" x2="30" y2="90" />
			</g>
			<path
				d="M74 40a24 24 0 1 0 8 42 28 28 0 0 1-8-42Z"
				className="onb-fade-in onb-delay-2"
			/>
		</svg>
	);
}

/** A shackle rotating down onto the body, then closed. */
export function LockIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="mx-auto text-[var(--accent)]"
			aria-hidden
		>
			<rect x="30" y="54" width="60" height="46" rx="8" pathLength={100} className="onb-draw" />
			<path
				d="M42 54V40a18 18 0 0 1 36 0v14"
				className="onb-close"
				style={{ transformOrigin: "42px 54px" }}
			/>
			<circle cx="60" cy="76" r="4" fill="currentColor" stroke="none" className="onb-fade-in onb-delay-3" />
		</svg>
	);
}

/** An envelope sliding in and drawing its flap. */
export function MailIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="mx-auto text-[var(--accent)] onb-slide-in"
			aria-hidden
		>
			<rect x="18" y="34" width="84" height="56" rx="6" pathLength={100} className="onb-draw" />
			<path d="M20 38l40 30 40-30" pathLength={100} className="onb-draw onb-delay-2" />
		</svg>
	);
}

/** A circle and a check, both drawn in. */
export function DoneIllustration() {
	return (
		<svg
			viewBox="0 0 120 120"
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="mx-auto text-[var(--accent)]"
			aria-hidden
		>
			<circle cx="60" cy="60" r="38" pathLength={100} className="onb-draw" />
			<path d="M42 61l13 13 24-28" pathLength={100} className="onb-draw onb-delay-2" />
		</svg>
	);
}
