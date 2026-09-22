/**
 * The window Juno shows while it is starting.
 *
 * Opening the database, running migrations and seeding reference data all
 * happen before the first window can paint anything truthful, and on a cold
 * start with a real mailbox that is a few seconds of nothing. A splash is the
 * honest answer: it says the name, it says what step it is on, and it goes away
 * the moment the application is ready.
 *
 * It is a data URL rather than a file, on purpose. It has to appear before the
 * app:// scheme is registered and before the renderer bundle is reachable, so
 * it cannot depend on either. Nothing here is user data, so the inline markup
 * is not a policy problem: there is no input and no remote origin.
 */
import { BrowserWindow, nativeTheme } from "electron";
import { windowIcon } from "./chrome";

let splash: BrowserWindow | null = null;

const WIDTH = 380;
const HEIGHT = 260;

function document_(dark: boolean): string {
	const paper = dark ? "#111117" : "#f6f6fa";
	const ink = dark ? "#eeeef5" : "#16161d";
	const muted = dark ? "#757589" : "#8b8b9c";
	const accent = dark ? "#a79df0" : "#4a3fa0";
	const line = dark ? "#2a2a35" : "#e3e2ec";

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @media (prefers-reduced-motion: reduce) {
    .mark, .sweep { animation: none !important; }
  }
  html, body {
    margin: 0; height: 100%;
    background: ${paper}; color: ${ink};
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-app-region: drag; user-select: none; overflow: hidden;
  }
  body {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px;
    border: 1px solid ${line}; border-radius: 14px; box-sizing: border-box;
  }
  /* The crescent draws itself in, then settles. One gesture, about a second,
     and it does not loop: a splash that keeps animating reads as stuck. */
  .mark { animation: rise var(--in) cubic-bezier(0.2, 0, 0.13, 1) both; }
  .mark path { stroke-dasharray: 120; stroke-dashoffset: 120; animation: draw 900ms cubic-bezier(0.2, 0, 0.13, 1) forwards; }
  .mark path.base { animation-delay: 260ms; }
  @keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  @keyframes draw { to { stroke-dashoffset: 0 } }
  .name { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .step { font-size: 12px; color: ${muted}; min-height: 16px; }
  .track { width: 168px; height: 2px; border-radius: 2px; background: ${line}; overflow: hidden; }
  /* Indeterminate: the work behind it has no percentage to report, and a fake
     one that jumps to 90 and waits is worse than none. */
  .sweep { width: 40%; height: 100%; border-radius: 2px; background: ${accent}; animation: sweep 1.4s ease-in-out infinite; }
  @keyframes sweep { 0% { transform: translateX(-110%) } 100% { transform: translateX(320%) } }
</style></head>
<body>
  <svg class="mark" viewBox="0 0 32 32" width="46" height="46" fill="none"
       stroke="${accent}" stroke-width="3" style="--in: 420ms">
    <path d="M22.4 6.2a9.2 9.2 0 1 0 3.4 15.8A10.8 10.8 0 0 1 22.4 6.2Z" stroke-linejoin="round"/>
    <path class="base" d="M5.5 27.2h21" stroke-linecap="round"/>
  </svg>
  <div class="name">Juno</div>
  <div class="track"><div class="sweep"></div></div>
  <div class="step" id="step">Starting</div>
</body></html>`;
}

export function showSplash(): BrowserWindow {
	splash = new BrowserWindow({
		width: WIDTH,
		height: HEIGHT,
		frame: false,
		transparent: false,
		resizable: false,
		movable: true,
		minimizable: false,
		maximizable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		show: false,
		icon: windowIcon(),
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#111117" : "#f6f6fa",
		webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
	});

	splash.once("ready-to-show", () => splash?.show());
	void splash.loadURL(
		`data:text/html;charset=utf-8,${encodeURIComponent(document_(nativeTheme.shouldUseDarkColors))}`,
	);

	return splash;
}

/** What the splash says it is doing. Ignored once the splash has closed. */
export function splashStep(text: string): void {
	if (!splash || splash.isDestroyed()) return;
	// JSON.stringify, not interpolation. These strings are ours today, and the
	// day one of them carries a migration name or an account label it still
	// cannot become code.
	void splash.webContents
		.executeJavaScript(
			`document.getElementById("step").textContent = ${JSON.stringify(text)};`,
		)
		.catch(() => undefined);
}

/**
 * Closed when the main window is ready to paint, not when it is created. Closing
 * earlier leaves a blank grey rectangle on screen, which is the exact gap the
 * splash exists to cover.
 */
export function closeSplash(): void {
	if (!splash || splash.isDestroyed()) return;
	splash.close();
	splash = null;
}
