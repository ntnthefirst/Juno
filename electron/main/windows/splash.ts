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

const WIDTH = 420;
const HEIGHT = 300;

function document_(dark: boolean): string {
	// The values of --paper, --ink, --ink-muted, --accent and --line in brand/tokens.css:
	// this document cannot load the stylesheet, so it carries them.
	const paper = dark ? "#101013" : "#f5f5f7";
	const ink = dark ? "#f0f0f4" : "#17171c";
	const muted = dark ? "#a2a3ae" : "#5b5c66";
	const accent = dark ? "#a79df0" : "#4a3fa0";
	const line = dark ? "#27272d" : "#ececf1";

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @media (prefers-reduced-motion: reduce) {
    .mark, .mark path { animation: none !important; stroke-dashoffset: 0 !important; }
  }
  html, body {
    margin: 0; height: 100%;
    background: ${paper}; color: ${ink};
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-app-region: drag; user-select: none; overflow: hidden;
  }
  body {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px;
    border: 1px solid ${line}; border-radius: 14px; box-sizing: border-box;
  }
  /* The crescent draws itself in, then settles. One gesture, about a second,
     and it does not loop: a splash that keeps animating reads as stuck. */
  .mark { animation: rise var(--in) cubic-bezier(0.2, 0, 0.13, 1) both; }
  .mark path { stroke-dasharray: 120; stroke-dashoffset: 120; animation: draw 900ms cubic-bezier(0.2, 0, 0.13, 1) forwards; }
  .mark path.base { animation-delay: 260ms; }
  @keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  @keyframes draw { to { stroke-dashoffset: 0 } }
  .brand { display: flex; align-items: center; gap: 14px; }
  .name { font-size: 32px; line-height: 40px; font-weight: 600; }
  .step { font-size: 14px; line-height: 21px; color: ${muted}; min-height: 21px; }
</style></head>
<body>
  <div class="brand">
    <svg class="mark" viewBox="0 0 32 32" width="40" height="40" fill="none"
         stroke="${accent}" stroke-width="3" style="--in: 420ms">
      <path d="M22.4 6.2a9.2 9.2 0 1 0 3.4 15.8A10.8 10.8 0 0 1 22.4 6.2Z" stroke-linejoin="round"/>
      <path class="base" d="M5.5 27.2h21" stroke-linecap="round"/>
    </svg>
    <div class="name">Juno</div>
  </div>
  <div class="step" id="step">Opening your data</div>
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
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#101013" : "#f5f5f7",
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
