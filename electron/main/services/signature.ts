/**
 * The signature image that gets stamped onto signed PDFs.
 *
 * The file is copied into the application's own folder rather than referenced
 * where the user found it. A path into Downloads is a path that stops resolving
 * the moment they tidy up, and a signed document is exactly the wrong place to
 * discover that.
 */
import { app, dialog } from "electron";
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import * as settings from "./settings";

const MAX_BYTES = 4 * 1024 * 1024;

function signatureDir(): string {
	const dir = join(app.getPath("userData"), "signature");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export async function getPath(): Promise<string | null> {
	const path = await settings.getSignaturePath();
	// A path that no longer resolves is reported as absent, so the interface
	// offers to set one instead of failing at signing time.
	if (!path || !existsSync(path)) return null;
	return path;
}

/**
 * Asks for an image and copies it in. Returns null when the picker is cancelled,
 * which is not an error.
 */
export async function choose(): Promise<string | null> {
	const result = await dialog.showOpenDialog({
		title: "Kies een handtekening",
		properties: ["openFile"],
		filters: [{ name: "Afbeelding", extensions: ["png"] }],
	});
	if (result.canceled || result.filePaths.length === 0) return null;

	const source = result.filePaths[0]!;
	if (extname(source).toLowerCase() !== ".png") {
		throw new Error("The signature has to be a PNG, so it can keep a transparent background.");
	}
	if (statSync(source).size > MAX_BYTES) {
		throw new Error("That image is larger than 4 MB. A signature does not need to be.");
	}

	const target = join(signatureDir(), "signature.png");
	copyFileSync(source, target);
	await settings.setSignaturePath(target);
	return target;
}

export async function clear(): Promise<void> {
	const path = await settings.getSignaturePath();
	if (path && existsSync(path)) unlinkSync(path);
	await settings.setSignaturePath(null);
}
