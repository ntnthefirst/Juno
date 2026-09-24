import { useCallback, useRef } from "react";

const STEP_THRESHOLD = 60;
const COOLDOWN_MS = 450;

/**
 * Turns a flurry of wheel events into at most one page per gesture.
 *
 * A trackpad flick emits dozens of small `deltaY` events over a couple of
 * hundred milliseconds. Summing until a threshold fires one step is not
 * enough by itself: the same flick crosses the threshold again before the
 * user has lifted their fingers, and the calendar flies through months. The
 * cooldown after a step is what actually stops that, not the threshold.
 *
 * Returns a function that takes a wheel event's `deltaY` and pages at most
 * once per `COOLDOWN_MS`. Callers decide what "over the view" means for
 * their own layout (a whole grid, or only its edges and header).
 */
export function useWheelPaging(onStep: (direction: -1 | 1) => void) {
	const delta = useRef(0);
	const cooling = useRef(false);

	return useCallback(
		(deltaY: number) => {
			if (cooling.current) return;
			delta.current += deltaY;
			if (Math.abs(delta.current) < STEP_THRESHOLD) return;
			const direction = delta.current > 0 ? 1 : -1;
			delta.current = 0;
			cooling.current = true;
			onStep(direction);
			window.setTimeout(() => {
				cooling.current = false;
			}, COOLDOWN_MS);
		},
		[onStep],
	);
}
