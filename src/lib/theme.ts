import { useEffect, useState } from "react";
import type { ThemeSetting } from "@shared/types";

/**
 * Applies the theme setting to the document.
 *
 * "system" removes the attribute entirely rather than resolving it to a value,
 * so the `prefers-color-scheme` block in tokens.css stays in charge and the
 * window follows the OS live, without anything here listening for a change.
 *
 * The main process sets `nativeTheme.themeSource` and repaints the native
 * caption buttons in the same breath (decision 14). Setting only one of them
 * gives a light title bar over a dark window.
 */
export function applyTheme(theme: ThemeSetting): void {
	const root = document.documentElement;
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
}

/**
 * The theme is application-wide, not per window, so this subscribes as well as
 * reads. A change made in the settings window has to repaint the main window
 * behind it, and both windows run this hook.
 */
export function useTheme(): [ThemeSetting, (next: ThemeSetting) => void] {
	const [theme, setTheme] = useState<ThemeSetting>("system");

	useEffect(() => {
		let cancelled = false;
		void window.juno.settings.getTheme().then((stored) => {
			if (cancelled) return;
			setTheme(stored);
			applyTheme(stored);
		});

		const off = window.juno.settings.onThemeChange((next) => {
			setTheme(next);
			applyTheme(next);
		});

		return () => {
			cancelled = true;
			off();
		};
	}, []);

	const update = (next: ThemeSetting) => {
		// Applied here as well as on the broadcast, so the window the choice was
		// made in does not wait a round trip to show it.
		setTheme(next);
		applyTheme(next);
		void window.juno.settings.setTheme(next);
	};

	return [theme, update];
}
