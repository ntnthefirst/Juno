import { createContext, useContext, useEffect, useId, useRef } from "react";

/**
 * One step in the trail. The last step is where you are, so it carries no
 * `onSelect`; every earlier one goes back to what it names.
 */
export type Crumb = {
	label: string;
	onSelect?: () => void;
};

export type BreadcrumbContextValue = {
	trail: Crumb[];
	publish: (id: string, trail: Crumb[]) => void;
	withdraw: (id: string) => void;
};

export const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/** What the shell reads to draw the trail. */
export function useBreadcrumbTrail(): Crumb[] {
	return useContext(BreadcrumbContext)?.trail ?? [];
}

/**
 * Called by whatever is showing a record. Pass the whole trail after the
 * wordmark, outermost first, so the screen's own name is the first step and
 * carries the handler that returns to its list. Passing an empty array is how a
 * screen says it is at its list, and the shell then draws the screen name alone.
 *
 * The labels decide when this republishes, so the callbacks may be fresh
 * closures on every render without causing a loop. They are read from the last
 * commit rather than the last publish, which is what makes a handler that was
 * rebuilt since the labels last changed still the one that runs.
 */
export function usePublishBreadcrumb(trail: Crumb[]): void {
	const context = useContext(BreadcrumbContext);
	const id = useId();
	const latest = useRef(trail);

	// Written in an effect, not during render. Effects fire in the order they are
	// declared, so the publishing effect below always reads this commit's trail.
	useEffect(() => {
		latest.current = trail;
	});

	const key = trail.map((crumb) => crumb.label).join("\u0000");

	// The two callbacks, not the context value. The value carries the trail, so
	// it is new after every publish, and an effect that depended on it published
	// again, which made a new trail, which made a new value: a screen with a name
	// in the title bar re-rendered the whole shell thousands of times a second
	// for as long as it was open. The callbacks never change.
	const publish = context?.publish;
	const withdraw = context?.withdraw;

	useEffect(() => {
		if (!publish || !withdraw) return;
		if (latest.current.length === 0) {
			withdraw(id);
			return;
		}
		publish(id, latest.current);
		// `key` is the real dependency: the labels are what gets drawn.
	}, [publish, withdraw, id, key]);

	useEffect(() => {
		if (!withdraw) return;
		return () => withdraw(id);
	}, [withdraw, id]);
}
