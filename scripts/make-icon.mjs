/**
 * Rasterises brand/logo/juno-icon.svg into build/icon.png at 1024x1024.
 *
 * electron-builder generates the .ico and .icns it needs from a single square
 * PNG of at least 512px, so one file covers every platform.
 *
 * Electron does the rasterising because it is already a dependency and it is a
 * real browser. Adding sharp or resvg would mean a native module, which this
 * project deliberately has none of (decision 18).
 *
 * Run: node scripts/make-icon.mjs
 */
import { app, BrowserWindow, screen, nativeImage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 1024;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
	const artFile = join(root, "brand", "art", "juno-icon-bureau.jpg");
	if (existsSync(artFile)) {
		const nativeImg = nativeImage.createFromPath(artFile);
		const resized = nativeImg.resize({ width: SIZE, height: SIZE, quality: "best" });
		const out = join(root, "build");
		mkdirSync(out, { recursive: true });
		writeFileSync(join(out, "icon.png"), resized.toPNG());
		console.log(`build/icon.png written from brand art at ${SIZE}x${SIZE}`);
		app.quit();
		return;
	}

	const svg = readFileSync(join(root, "brand", "logo", "juno-icon.svg"), "utf8");

	// capturePage() returns device pixels, so a window sized in CSS pixels on a
	// 1.5x display produces a 1536px image. Dividing by the scale factor makes the
	// output exactly SIZE, which keeps the icon on power-of-two boundaries.
	const scale = screen.getPrimaryDisplay().scaleFactor || 1;
	const logical = Math.round(SIZE / scale);

	const window = new BrowserWindow({
		width: logical,
		height: logical,
		show: false,
		frame: false,
		transparent: true,
		webPreferences: { offscreen: true },
	});

	const page = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${logical}px;height:${logical}px;background:transparent}
  svg{display:block;width:${logical}px;height:${logical}px}
</style>${svg}`;

	await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
	// The SVG is inline with no external references, so one frame is enough once
	// the document has loaded.
	await new Promise((resolve) => setTimeout(resolve, 500));

	const image = await window.webContents.capturePage();
	const out = join(root, "build");
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "icon.png"), image.toPNG());

	const { width, height } = image.getSize();
	console.log(`build/icon.png written at ${width}x${height}`);

	app.quit();
});
