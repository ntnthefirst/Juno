/**
 * Draws the Windows installer's artwork into build/.
 *
 * NSIS will only take BMP for the sidebar and header, at exact pixel sizes it
 * does not scale. So the panels are laid out as HTML, captured with Electron
 * (already a dependency, and a real browser: decision 18 rules out adding a
 * native rasteriser), and written out as 24-bit bottom-up bitmaps.
 *
 * Run: npm run icons
 */
import { app, BrowserWindow } from "electron";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build");

const PAPER = "#f6f6fa";
const INK = "#16161d";
const MUTED = "#5d5e70";
const ACCENT = "#4a3fa0";

const MARK = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3">
  <path d="M22.4 6.2a9.2 9.2 0 1 0 3.4 15.8A10.8 10.8 0 0 1 22.4 6.2Z" stroke-linejoin="round"/>
  <path d="M5.5 27.2h21" stroke-linecap="round"/>
</svg>`;

/**
 * The tall panel down the left of the welcome and finish pages. Deliberately
 * quiet: a mark, the name, and one line saying what the thing is. An installer
 * is not a place to sell something already being installed.
 */
function sidebar() {
	return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:164px;height:314px;overflow:hidden}
  body{background:${ACCENT};color:#f8f8fc;font-family:Inter,"Segoe UI",system-ui,sans-serif;
       display:flex;flex-direction:column;justify-content:flex-end;padding:20px;box-sizing:border-box}
  .mark{width:38px;height:38px;color:#f8f8fc;opacity:.95}
  .name{font-size:22px;font-weight:600;letter-spacing:-.02em;margin-top:14px}
  .sub{font-size:11px;line-height:1.45;opacity:.72;margin-top:6px}
  /* A hairline that reads as the roofline in the mark, continued. */
  .rule{height:1px;background:#f8f8fc;opacity:.28;margin:14px 0 0}
</style>
<div class="mark">${MARK}</div>
<div class="name">Juno</div>
<div class="rule"></div>
<div class="sub">Your clients, contracts, mail and calendar. On this machine.</div>`;
}

/** The small badge top-right of every page after the first. */
function header() {
	return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:150px;height:57px;overflow:hidden}
  body{background:${PAPER};color:${INK};font-family:Inter,"Segoe UI",system-ui,sans-serif;
       display:flex;align-items:center;gap:9px;padding:0 14px;box-sizing:border-box}
  .mark{width:22px;height:22px;color:${ACCENT};flex:none}
  .name{font-size:15px;font-weight:600;letter-spacing:-.01em}
  .sub{font-size:9px;color:${MUTED}}
</style>
<div class="mark">${MARK}</div>
<div><div class="name">Juno</div><div class="sub">Back office</div></div>`;
}

/**
 * BGRA from Electron to a 24-bit BMP. NSIS reads the oldest, plainest form of
 * the format: BITMAPINFOHEADER, no compression, bottom-up, rows padded to four
 * bytes. A 32-bit or top-down bitmap loads as garbage rather than failing.
 */
function toBmp(bgra, width, height) {
	const rowSize = Math.ceil((width * 3) / 4) * 4;
	const pixels = Buffer.alloc(rowSize * height);

	for (let y = 0; y < height; y++) {
		const source = (height - 1 - y) * width * 4;
		let target = y * rowSize;
		for (let x = 0; x < width; x++) {
			pixels[target++] = bgra[source + x * 4];
			pixels[target++] = bgra[source + x * 4 + 1];
			pixels[target++] = bgra[source + x * 4 + 2];
		}
	}

	const header = Buffer.alloc(54);
	header.write("BM", 0, "ascii");
	header.writeUInt32LE(54 + pixels.length, 2);
	header.writeUInt32LE(54, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(24, 28);
	header.writeUInt32LE(pixels.length, 34);
	// 2835 pixels per metre, which is the 72dpi every tool writes here.
	header.writeInt32LE(2835, 38);
	header.writeInt32LE(2835, 42);

	return Buffer.concat([header, pixels]);
}

/**
 * One offscreen window, resized per panel. A second offscreen window created
 * after the first is destroyed never fires did-finish-load on this platform, so
 * the window is made once and kept until the last capture.
 */
let window_ = null;

async function render(html, width, height, file) {
	// The panel is laid out at its true size in CSS pixels, so the window is
	// that size too. capturePage then returns device pixels, which on a 1.5x
	// display is larger than NSIS accepts, and the resize below brings it back
	// down. Sizing the window by device pixels instead would shrink the layout
	// and crop it, which is exactly what it did the first time.
	if (!window_) {
		window_ = new BrowserWindow({
			width,
			height,
			show: false,
			frame: false,
			useContentSize: true,
			webPreferences: { offscreen: true },
		});
	} else {
		window_.setContentSize(width, height);
	}

	// A data URL loaded a second time in one process reports ERR_ABORTED even
	// though the document renders. The load event is what matters.
	const loaded = new Promise((resolve) => window_.webContents.once("did-finish-load", resolve));
	void window_
		.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
		.catch(() => undefined);
	await loaded;
	await new Promise((resolve) => setTimeout(resolve, 400));

	const image = (await window_.capturePage()).resize({ width, height, quality: "best" });
	writeFileSync(join(out, file), toBmp(image.toBitmap(), width, height));
	console.log(`build/${file}  ${width}x${height}`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
	mkdirSync(out, { recursive: true });
	await render(sidebar(), 164, 314, "installerSidebar.bmp");
	// The same panel. Rendering it twice would only risk the two drifting apart.
	copyFileSync(join(out, "installerSidebar.bmp"), join(out, "uninstallerSidebar.bmp"));
	console.log("build/uninstallerSidebar.bmp  164x314");
	await render(header(), 150, 57, "installerHeader.bmp");
	window_?.destroy();
	app.quit();
});
