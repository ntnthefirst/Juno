import { useEffect, useRef, useState, type CSSProperties } from "react";

/** The step between one item and the next as a list arrives, in milliseconds. */
const STEP = 36;
/** Past this many, everything arrives together: a long list is not a show. */
const MAX_STAGGERED = 10;

/**
 * The delay that makes the nth item of a list arrive a beat after the one
 * before it. Pair it with a class that has an animation on it (`animate-rise`);
 * the animation holds the item invisible until its turn.
 */
export function stagger(index: number): CSSProperties {
	return { animationDelay: `${Math.min(index, MAX_STAGGERED) * STEP}ms` };
}

/** Whether the person asked the system for less movement. */
export function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A number that counts up to its value rather than appearing. It starts from
 * zero the first time it has a value, and goes from where it was to the new
 * value after that. With reduced motion asked for it is simply the value.
 *
 * `null` means "not known yet" and stays null, so the caller can draw a dash.
 */
export function useCountUp(target: number | null, duration = 700): number | null {
	const [shown, setShown] = useState<number | null>(null);
	// Where the count had got to, so a new value continues from it.
	const last = useRef(0);

	useEffect(() => {
		if (target === null) return;
		const from = last.current;
		let frame = 0;

		if (prefersReducedMotion() || from === target) {
			frame = requestAnimationFrame(() => {
				last.current = target;
				setShown(target);
			});
			return () => cancelAnimationFrame(frame);
		}

		let startedAt: number | null = null;
		const tick = (now: number) => {
			startedAt ??= now;
			const t = Math.min(1, (now - startedAt) / duration);
			// Out-expo, the same decelerate as the rest of the motion.
			const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
			const value = Math.round(from + (target - from) * eased);
			last.current = value;
			setShown(value);
			if (t < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [target, duration]);

	return target === null ? null : (shown ?? 0);
}
