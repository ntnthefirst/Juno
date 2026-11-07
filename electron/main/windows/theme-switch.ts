/**
 * Getting a theme change onto every window in one frame.
 *
 * Two things change when the theme does: the page, drawn by each renderer,
 * and the native surfaces (caption buttons, window background), drawn by the
 * operating system the moment they are told. Telling the OS first is what made
 * the caption buttons flip a third of a second before the page caught up. So
 * the page goes first: every window is sent the new theme, applies it and
 * answers after the frame that shows it, and only then are the native surfaces
 * changed, which lands them in the same frame or the one after.
 *
 * A window that never answers (minimised, busy, or one with no bridge, like
 * the splash) is not waited for past ANSWER_LIMIT_MS. Only windows that have
 * answered once are waited for at all, so a window still loading does not hold
 * the change up: it reads the theme for itself when it mounts.
 */
import { BrowserWindow, type WebContents } from "electron";
import type { ThemeSetting } from "../../shared/types";

/** Longer than a slow frame, shorter than anything a person would notice. */
const ANSWER_LIMIT_MS = 120;

const answering = new Set<number>();
const waiting = new Map<number, () => void>();

/** A window's renderer has applied the theme it was sent and painted it. */
export function themeApplied(contents: WebContents): void {
	if (!answering.has(contents.id)) {
		answering.add(contents.id);
		const id = contents.id;
		contents.once("destroyed", () => {
			answering.delete(id);
			waiting.get(id)?.();
			waiting.delete(id);
		});
	}
	const done = waiting.get(contents.id);
	waiting.delete(contents.id);
	done?.();
}

/** Sends the theme to every window and resolves once the pages show it. */
export async function sendThemeToPages(theme: ThemeSetting): Promise<void> {
	const answers: Array<Promise<void>> = [];
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		const contents = window.webContents;
		if (answering.has(contents.id) && window.isVisible() && !window.isMinimized()) {
			// A switch made while the last one is still waiting releases it.
			waiting.get(contents.id)?.();
			answers.push(new Promise<void>((resolve) => waiting.set(contents.id, resolve)));
		}
		contents.send("settings.themeChanged", theme);
	}
	if (answers.length === 0) return;
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		Promise.all(answers),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, ANSWER_LIMIT_MS);
		}),
	]);
	clearTimeout(timer);
}
