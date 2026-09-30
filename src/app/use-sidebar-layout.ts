import { useCallback, useEffect, useState } from "react";

/**
 * How the sidebar behaves at the current window width.
 *
 * Three states, and the window decides which two are available:
 *
 * - **Wide** (>= 1100px): beside the content, expanded or collapsed to a rail.
 *   The toggle switches between those two.
 * - **Medium** (760 to 1100px): the same.
 * - **Narrow** (< 760px): out of the layout entirely. The toggle floats it over
 *   the content as a drawer, which closes on Escape, on a click outside, and
 *   when something in it is chosen.
 *
 * Docked, it starts as the rail. With `autoCollapse` on, which is the default
 * setting, an expanded sidebar goes back to the rail the same way the drawer
 * closes: when something in it is chosen, or anything beside it is clicked.
 * With it off, the toggle's choice is remembered and nothing else changes it.
 *
 * The remembered preference is a per-viewer convenience, so it lives in
 * localStorage and a failure to read it is not worth reporting.
 */
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
	/** Shuts the drawer, and collapses a docked sidebar when auto-collapse is on. */
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

function store(collapsed: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, String(collapsed));
	} catch {
		// A private window or blocked site data. The sidebar still works,
		// it just forgets the choice on the next launch.
	}
}

export function useSidebarLayout(autoCollapse: boolean): SidebarLayout {
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

	const docked = !floating;
	const expanded = preference === false;

	// The docked counterpart of the drawer's backdrop. A docked sidebar has no
	// backdrop to click, so a press anywhere outside it is heard here instead.
	// The title bar toggle is left out, or pressing it to close the sidebar
	// would collapse it on the way down and open it again on the click.
	useEffect(() => {
		if (!docked || !expanded || !autoCollapse) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest("[data-sidebar], [data-sidebar-toggle]")) return;
			setPreference(true);
			store(true);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [docked, expanded, autoCollapse]);

	const close = useCallback(() => {
		setDrawerOpen(false);
		if (!autoCollapse) return;
		// Stored as well, so a launch after a collapse opens on the rail it
		// was left on rather than on whatever the toggle last said.
		setPreference((current) => {
			if (current === true) return current;
			store(true);
			return true;
		});
	}, [autoCollapse]);

	const toggle = useCallback(() => {
		if (floating) {
			setDrawerOpen((open) => !open);
			return;
		}
		setPreference((current) => {
			const next = !(current ?? true);
			store(next);
			return next;
		});
	}, [floating]);

	if (floating) {
		// A drawer is always full width: a 56px rail floating over the content
		// would be a worse version of the toggle that opened it.
		return { visible: drawerOpen, collapsed: false, floating: true, toggle, close };
	}

	return { visible: true, collapsed: preference ?? true, floating: false, toggle, close };
}
