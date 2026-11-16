import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * How long a first click waits for a second before it counts as one click.
 * Windows lets the person set the double-click time and does not tell a page
 * what it is; this is close to what most people feel as a double click, and a
 * preview that opens a quarter second late reads as deliberate.
 */
export const DOUBLE_CLICK_MS = 250;

type Timer = {
	set: (run: () => void, ms: number) => number;
	clear: (handle: number) => void;
};

const WINDOW_TIMER: Timer = {
	set: (run, ms) => window.setTimeout(run, ms),
	clear: (handle) => window.clearTimeout(handle),
};

export type ClickHandlers<T> = {
	single: (target: T) => void;
	double: (target: T) => void;
};

export type ClickGate<T> = {
	/** One press. `count` is the event's `detail`, the platform's own click count. */
	click: (target: T, count: number) => void;
	/** Forgets a click still waiting, so a list that goes away does not open a preview afterwards. */
	cancel: () => void;
};

/**
 * Tells a single click from a double click on the same thing, so a double
 * click does not flash the single click's result first.
 *
 * A first click is held for `delay`. A second one on the same target inside
 * that time, or any click the platform already counts as the second, cancels
 * it and is a double click. A click on something else while one is held lets
 * the held one go and starts waiting again, because two quick clicks on two
 * rows are two choices, not one double click.
 */
export function createClickGate<T>(
	handlers: ClickHandlers<T>,
	options: { delay?: number; timer?: Timer; same?: (a: T, b: T) => boolean } = {},
): ClickGate<T> {
	const delay = options.delay ?? DOUBLE_CLICK_MS;
	const timer = options.timer ?? WINDOW_TIMER;
	const same = options.same ?? ((a: T, b: T) => a === b);
	let held: { target: T; handle: number } | null = null;

	function release() {
		if (!held) return;
		timer.clear(held.handle);
		held = null;
	}

	return {
		click(target, count) {
			if (held && same(held.target, target)) {
				release();
				handlers.double(target);
				return;
			}
			if (count >= 2) {
				release();
				handlers.double(target);
				return;
			}
			release();
			const handle = timer.set(() => {
				held = null;
				handlers.single(target);
			}, delay);
			held = { target, handle };
		},
		cancel: release,
	};
}

/**
 * The same gate for a component. The handlers are read when the click is
 * decided, not when the gate was made, so a row that re-renders between the
 * two clicks still runs what it says now.
 */
export function useClickGate<T>(handlers: ClickHandlers<T>, same?: (a: T, b: T) => boolean): ClickGate<T> {
	const latest = useRef(handlers);
	useEffect(() => {
		latest.current = handlers;
	});
	const compare = useRef(same);
	useEffect(() => {
		compare.current = same;
	});
	// Made on the first click rather than during render, so nothing here reads a ref while drawing.
	const gate = useRef<ClickGate<T> | null>(null);
	const made = useCallback((): ClickGate<T> => {
		gate.current ??= createClickGate<T>(
			{
				single: (target) => latest.current.single(target),
				double: (target) => latest.current.double(target),
			},
			{ same: (a, b) => (compare.current ? compare.current(a, b) : a === b) },
		);
		return gate.current;
	}, []);
	useEffect(() => () => gate.current?.cancel(), []);
	return useMemo(
		() => ({
			click: (target: T, count: number) => made().click(target, count),
			cancel: () => gate.current?.cancel(),
		}),
		[made],
	);
}
