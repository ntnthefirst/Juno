import { useEffect, useState } from "react";
import type { ThemeSetting } from "@shared/types";

/**
 * Applies the theme setting to the document.
 *
 * "system" removes the attribute entirely rather than resolving it to a value,
 * so the `prefers-color-scheme` block in tokens.css stays in charge and the
 * window follows the OS live, without anything here listening for a change.
 *
 * The main process sets `nativeTheme.themeSource` in the same breath (decision
 * 14). Setting only one of the two gives a light title bar over a dark window.
 */
export function applyTheme(theme: ThemeSetting): void {
	const root = document.documentElement;
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
}

export function useTheme(): [ThemeSetting, (next: ThemeSetting) => void] {
	const [theme, setTheme] = useState<ThemeSetting>("system");

	useEffect(() => {
		let cancelled = false;
		void window.juno.settings.getTheme().then((stored) => {
			if (cancelled) return;
			setTheme(stored);
			applyTheme(stored);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const update = (next: ThemeSetting) => {
		setTheme(next);
		applyTheme(next);
		void window.juno.settings.setTheme(next);
	};

	return [theme, update];
}
