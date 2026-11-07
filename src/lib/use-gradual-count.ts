import { useEffect, useState } from "react";

/**
 * How many rows of a long list to draw right now. The first screenful goes in
 * the first render so the list appears at once, and the rest follow a frame at
 * a time, so five hundred rows never hold the window for one long frame.
 */
export function useGradualCount(total: number, first = 60, step = 120): number {
	const [count, setCount] = useState(first);

	useEffect(() => {
		if (count >= total) return;
		const id = requestAnimationFrame(() => setCount((current) => Math.min(current + step, total)));
		return () => cancelAnimationFrame(id);
	}, [count, total, step]);

	return Math.min(count, total);
}
