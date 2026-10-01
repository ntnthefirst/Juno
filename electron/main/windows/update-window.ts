/**
 * The window Juno shows while it prepares to install an update.
 *
 * Without it, pressing Install or closing the app with an update waiting made
 * every window vanish and left nothing on screen until the new version opened.
 * This one says what is happening: the download, then closing down. Once the
 * app quits, the installer's own progress window takes over (build/installer.nsh).
 *
 * Built like the splash, as a data URL, because it has to stay up while the
 * rest of the application is being torn down and cannot depend on the renderer
 * bundle or on the scheme being served.
 */
import { BrowserWindow, nativeTheme } from "electron";
import { windowIcon } from "./chrome";

let win: BrowserWindow | null = null;

const WIDTH = 380;
const HEIGHT = 260;

export type UpdateWindowState = {
	/** One short line, what Juno is doing right now. */
	step: string;
	/** 0 to 100 for a measurable step, null while the length is unknown. */
	percent: number | null;
	/** A failure replaces the progress bar and the window can then be closed. */
	error?: string | null;
};

function document_(dark: boolean, from: string, to: string | null): string {
	const paper = dark ? "#111117" : "#f6f6fa";
	const ink = dark ? "#eeeef5" : "#16161d";
	const muted = dark ? "#757589" : "#8b8b9c";
	const accent = dark ? "#a79df0" : "#4a3fa0";
	const line = dark ? "#2a2a35" : "#e3e2ec";
	const risk = dark ? "#f08a8a" : "#b3261e";
	const versions = to ? `${from} to ${to}` : from;

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @media (prefers-reduced-motion: reduce) { .sweep { animation: none !important; } }
  html, body {
    margin: 0; height: 100%;
    background: ${paper}; color: ${ink};
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-app-region: drag; user-select: none; overflow: hidden;
  }
  body {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px;
    border: 1px solid ${line}; border-radius: 14px; box-sizing: border-box;
    padding: 0 28px; text-align: center;
  }
  .name { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .versions { font-size: 12px; color: ${muted}; font-variant-numeric: tabular-nums; }
  .track { width: 220px; height: 3px; border-radius: 3px; background: ${line}; overflow: hidden; }
  .bar { height: 100%; border-radius: 3px; background: ${accent}; transition: width 180ms ease; }
  .sweep { width: 40%; animation: sweep 1.4s ease-in-out infinite; }
  @keyframes sweep { 0% { transform: translateX(-110%) } 100% { transform: translateX(320%) } }
  .step { font-size: 13px; min-height: 18px; }
  .note { font-size: 12px; color: ${muted}; min-height: 16px; }
  .error { color: ${risk}; }
</style></head>
<body>
  <svg viewBox="0 0 32 32" width="40" height="40" fill="none" stroke="${accent}" stroke-width="3">
    <path d="M22.4 6.2a9.2 9.2 0 1 0 3.4 15.8A10.8 10.8 0 0 1 22.4 6.2Z" stroke-linejoin="round"/>
    <path d="M5.5 27.2h21" stroke-linecap="round"/>
  </svg>
  <div class="name">Updating Juno</div>
  <div class="versions">${versions}</div>
  <div class="track"><div class="bar sweep" id="bar"></div></div>
  <div class="step" id="step">Preparing</div>
  <div class="note" id="note">Juno restarts on its own when this is done.</div>
</body></html>`;
}

export function showUpdateWindow(from: string, to: string | null): void {
	if (win && !win.isDestroyed()) {
		win.focus();
		return;
	}
	win = new BrowserWindow({
		width: WIDTH,
		height: HEIGHT,
		frame: false,
		resizable: false,
		movable: true,
		minimizable: false,
		maximizable: false,
		skipTaskbar: false,
		alwaysOnTop: true,
		show: false,
		icon: windowIcon(),
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#111117" : "#f6f6fa",
		webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	win.once("ready-to-show", () => win?.show());
	win.on("closed", () => {
		win = null;
	});
	void win.loadURL(
		`data:text/html;charset=utf-8,${encodeURIComponent(document_(nativeTheme.shouldUseDarkColors, from, to))}`,
	);
}

export function updateWindowOpen(): boolean {
	return win !== null && !win.isDestroyed();
}

/** What the window says it is doing. Ignored once it has closed. */
export function setUpdateWindow(state: UpdateWindowState): void {
	if (!win || win.isDestroyed()) return;
	// JSON.stringify, not interpolation: the error text carries whatever the
	// updater threw, and it must not be able to become code.
	const script = `(() => {
		const bar = document.getElementById("bar");
		const step = document.getElementById("step");
		const note = document.getElementById("note");
		const percent = ${JSON.stringify(state.percent)};
		const error = ${JSON.stringify(state.error ?? null)};
		step.textContent = ${JSON.stringify(state.step)};
		step.classList.toggle("error", error !== null);
		note.textContent = error !== null ? error : "Juno restarts on its own when this is done.";
		if (percent === null) {
			bar.classList.add("sweep");
			bar.style.width = "";
		} else {
			bar.classList.remove("sweep");
			bar.style.width = percent + "%";
		}
	})();`;
	void win.webContents.executeJavaScript(script).catch(() => undefined);
}

export function closeUpdateWindow(): void {
	if (!win || win.isDestroyed()) return;
	win.close();
	win = null;
}
