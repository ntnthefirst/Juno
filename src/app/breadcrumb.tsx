import { useCallback, useMemo, useState, type ReactNode } from "react";
import { BreadcrumbContext, type BreadcrumbContextValue, type Crumb } from "./breadcrumb-context";

type BreadcrumbProviderProps = {
	children: ReactNode;
};

/**
 * A record that opens full screen has to say so in the title bar, or there is
 * nothing on screen naming which client you are looking at and no way back
 * except the sidebar. The shell owns the trail and the screen feeds it, rather
 * than each screen drawing a header of its own, so every screen gets the same
 * one in the same place.
 *
 * Only the deepest publisher wins. A screen publishes its trail and something
 * inside it may publish a longer one; the later mount is the deeper one, so it
 * takes over until it unmounts.
 */
export function BreadcrumbProvider({ children }: BreadcrumbProviderProps) {
	const [entries, setEntries] = useState<{ id: string; trail: Crumb[] }[]>([]);

	const publish = useCallback((id: string, trail: Crumb[]) => {
		setEntries((current) => {
			const rest = current.filter((entry) => entry.id !== id);
			return [...rest, { id, trail }];
		});
	}, []);

	const withdraw = useCallback((id: string) => {
		setEntries((current) =>
			current.some((entry) => entry.id === id)
				? current.filter((entry) => entry.id !== id)
				: // Returning the same array matters: a screen with no trail withdraws
					// on every commit, and a new array each time would re-render the shell
					// for nothing.
					current,
		);
	}, []);

	const value = useMemo<BreadcrumbContextValue>(
		() => ({
			trail: entries.length === 0 ? [] : entries[entries.length - 1]!.trail,
			publish,
			withdraw,
		}),
		[entries, publish, withdraw],
	);

	return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}
