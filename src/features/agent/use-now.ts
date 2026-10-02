import { useEffect, useState } from "react";

/**
 * The current time, kept fresh, for a list that says "5 min ago". The clock is
 * impure, so it is read in an effect and held in state, and it moves on its
 * own so a request left open does not keep saying "just now".
 */
export function useNow(everyMs = 30_000): number | null {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		const read = () => setNow(Date.now());
		const first = window.setTimeout(read, 0);
		const timer = window.setInterval(read, everyMs);
		return () => {
			window.clearTimeout(first);
			window.clearInterval(timer);
		};
	}, [everyMs]);
	return now;
}
