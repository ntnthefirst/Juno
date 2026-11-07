import { useEffect, useState } from "react";
import type { ThemeSetting } from "@shared/types";

/**
 * How long transitions stay off after a theme change. Long enough to cover
 * the main process changing `nativeTheme.themeSource` after this page answered,
 * which is when a switch to or from "system" actually changes the colours here
 * (prefers-color-scheme follows the theme source, not the attribute).
 */
const HOLD_MS = 300;

let holdTimer: number | undefined;

/**
 * Turns every transition off for a moment, so a theme change lands in one
 * frame instead of each hover colour easing across on its own clock. That
 * easing is what made a switch look like the page was being redrawn piece by
 * piece. global.css holds the rule; this only sets and clears the attribute.
 */
function holdTransitions(): void {
	const root = document.documentElement;
	root.setAttribute("data-theme-switching", "");
	window.clearTimeout(holdTimer);
	holdTimer = window.setTimeout(() => root.removeAttribute("data-theme-switching"), HOLD_MS);
}

/**
 * Applies the theme setting to the document.
 *
 * "system" removes the attribute entirely rather than resolving it to a value,
 * so the `prefers-color-scheme` block in tokens.css stays in charge and the
 * window follows the OS live, without anything here listening for a change.
 *
 * The main process sets `nativeTheme.themeSource` and repaints the native
 * caption buttons once every page has answered (decision 14, and
 * electron/main/windows/theme-switch.ts). Setting only one of them gives a
 * light title bar over a dark window.
 */
export function applyTheme(theme: ThemeSetting): void {
	const root = document.documentElement;
	const current = root.getAttribute("data-theme") ?? "system";
	if (current === theme) return;
	holdTransitions();
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
}

/**
 * Calls back once the frame showing the current styles has been produced: the
 * animation frame runs before that frame's style and paint, and the task after
 * it runs once they are done. A hidden window produces no frames, so it
 * answers at once rather than holding up the switch.
 */
function afterPaint(callback: () => void): void {
	if (document.visibilityState === "hidden") {
		callback();
		return;
	}
	requestAnimationFrame(() => window.setTimeout(callback, 0));
}

function answer(): void {
	// Refused while locked, which is fine: nothing changes the theme then.
	void window.juno.settings.themeApplied().catch(() => undefined);
}

/**
 * Keeps this window on the application's theme, without any React state.
 *
 * The theme is application-wide, not per window, so this subscribes as well as
 * reads: a change made in the settings window has to repaint the main window
 * behind it. It never sets state, because a state change at the root of a
 * window re-renders everything under it, which is the slowest possible way to
 * change a few CSS variables.
 */
export function useThemeSync(): void {
	useEffect(() => {
		let cancelled = false;
		void window.juno.settings.getTheme().then((stored) => {
			if (cancelled) return;
			applyTheme(stored);
			afterPaint(answer);
		});

		const off = window.juno.settings.onThemeChange((next) => {
			applyTheme(next);
			afterPaint(answer);
		});

		// While the setting is "system" the OS can change theme under the app,
		// and the colours here follow without the attribute changing. The
		// listener runs before the style update of that frame, so holding
		// transitions here still stops them easing across.
		const scheme = window.matchMedia("(prefers-color-scheme: dark)");
		scheme.addEventListener("change", holdTransitions);

		return () => {
			cancelled = true;
			off();
			scheme.removeEventListener("change", holdTransitions);
		};
	}, []);
}

/**
 * The theme setting, for a window that shows the choice (settings, setup).
 * Choosing does not apply anything here: the main process sends the change to
 * every window at once, this one included, so the window the choice was made
 * in and the one behind it change in the same frame.
 */
export function useTheme(): [ThemeSetting, (next: ThemeSetting) => void] {
	useThemeSync();
	const [theme, setTheme] = useState<ThemeSetting>("system");

	useEffect(() => {
		let cancelled = false;
		void window.juno.settings.getTheme().then((stored) => {
			if (!cancelled) setTheme(stored);
		});
		const off = window.juno.settings.onThemeChange(setTheme);
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	const update = (next: ThemeSetting) => {
		// The control shows the choice at once; the colours follow with every
		// other window's.
		setTheme(next);
		void window.juno.settings.setTheme(next);
	};

	return [theme, update];
}
