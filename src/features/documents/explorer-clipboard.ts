/**
 * What Ctrl C or Ctrl X last took in the explorer: document ids, and whether
 * pasting copies them or moves them. It is the explorer's own and not the
 * system clipboard, because what it holds are records here, not files a
 * program elsewhere could paste, and it lives as long as the window, so a
 * copy made in one folder pastes into the next one opened.
 */
export type ExplorerClipboard = { mode: "copy" | "cut"; ids: string[] };

let held: ExplorerClipboard | null = null;

export function readClipboard(): ExplorerClipboard | null {
	return held;
}

export function writeClipboard(next: ExplorerClipboard | null): void {
	held = next && next.ids.length > 0 ? { mode: next.mode, ids: [...next.ids] } : null;
}
