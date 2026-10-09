import { useCallback, useEffect, useState } from "react";
import { messageOf } from "./errors";

export type Loaded<T> =
	| { status: "loading" }
	| { status: "ready"; value: T }
	| { status: "error"; message: string };

/**
 * One read from the main process, held with its state. `load` has to be stable
 * (a module-level function or a `useCallback`), because a new function reads
 * again.
 *
 * `reload` reads again and keeps the old value on screen until the new one
 * lands, so a list refreshing after an edit does not blink through "Loading".
 * A read that finishes after the screen has gone is dropped.
 */
export function useLoaded<T>(load: () => Promise<T>): Loaded<T> & { reload: () => void } {
	const [state, setState] = useState<Loaded<T>>({ status: "loading" });
	const [version, setVersion] = useState(0);

	useEffect(() => {
		let cancelled = false;
		load()
			.then((value) => {
				if (!cancelled) setState({ status: "ready", value });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setState({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [load, version]);

	const reload = useCallback(() => setVersion((current) => current + 1), []);
	return { ...state, reload };
}
