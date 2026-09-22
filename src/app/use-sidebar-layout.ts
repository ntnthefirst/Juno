import { useCallback, useEffect, useState } from "react";

/**
 * How the sidebar behaves at the current window width.
 *
 * Three states, and the window decides which two are available:
 *
 * - **Wide** (>= 1100px): beside the content, expanded or collapsed to a rail.
 *   The toggle switches between those two and the choice is remembered.
 * - **Medium** (760 to 1100px): the same, but a rail by default, because at
 *   this width a 248px sidebar is a third of the screen.
 * - **Narrow** (< 760px): out of the layout entirely. The toggle floats it over
 *   the content as a drawer, which closes on Escape, on a click outside, and
 *   when something in it is chosen.
 *
 * The remembered preference is a per-viewer convenience, so it lives in
 * localStorage and a failure to read it is not worth reporting.
 */
const RAIL_BELOW = 1100;
const FLOAT_BELOW = 760;
const STORAGE_KEY = "juno.sidebar.collapsed";

export type SidebarLayout = {
	/** In the layout at all. False on a narrow window with the drawer shut. */
	visible: boolean;
	/** Icons only. */
	collapsed: boolean;
	/** Over the content rather than beside it. */
	floating: boolean;
	toggle: () => void;
	close: () => void;
};

function readStored(): boolean | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw === null ? null : raw === "true";
	} catch {
		return null;
	}
}

export function useSidebarLayout(): SidebarLayout {
	const [width, setWidth] = useState(() => window.innerWidth);
	const [preference, setPreference] = useState<boolean | null>(readStored);
	const [drawerOpen, setDrawerOpen] = useState(false);

	const floating = width < FLOAT_BELOW;

	useEffect(() => {
		const onResize = () => {
			setWidth(window.innerWidth);
			// The drawer is a narrow-window affordance. Widening the window while
			// it is open should give back the docked sidebar, not leave a panel
			// hanging over the content. Done here, in the resize itself, rather
			// than in an effect watching the width it produces.
			if (window.innerWidth >= FLOAT_BELOW) setDrawerOpen(false);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	useEffect(() => {
		if (!drawerOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setDrawerOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [drawerOpen]);

	const close = useCallback(() => setDrawerOpen(false), []);

	const toggle = useCallback(() => {
		if (floating) {
			setDrawerOpen((open) => !open);
			return;
		}
		setPreference((current) => {
			const next = !(current ?? width < RAIL_BELOW);
			try {
				localStorage.setItem(STORAGE_KEY, String(next));
			} catch {
				// A private window or blocked site data. The sidebar still works,
				// it just forgets the choice on the next launch.
			}
			return next;
		});
	}, [floating, width]);

	if (floating) {
		// A drawer is always full width: a 56px rail floating over the content
		// would be a worse version of the toggle that opened it.
		return { visible: drawerOpen, collapsed: false, floating: true, toggle, close };
	}

	const collapsed = preference ?? width < RAIL_BELOW;
	return { visible: true, collapsed, floating: false, toggle, close };
}
