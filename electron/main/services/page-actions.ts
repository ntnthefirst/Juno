/**
 * The two things a page does that need the operating system: asking for a
 * picture, and opening a link. Apart from pages.ts and page-images.ts so those
 * stay testable in plain Node.
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { dialog, shell } from "electron";
import { safeLinkHref, type ImageBlock } from "../../shared/blocks";
import { MAX_ASSET_BYTES } from "./document-template-assets";
import * as pageImages from "./page-images";

/**
 * Asks for a picture and keeps it with the page, returning the block that
 * shows it. Null when the picker is cancelled, which is not an error. The
 * window never holds the path: the file is read here and copied into the
 * page's own folder.
 */
export async function chooseImage(pageId: string): Promise<ImageBlock | null> {
	const result = await dialog.showOpenDialog({
		title: "Choose a picture",
		properties: ["openFile"],
		filters: [{ name: "Picture", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
	});
	if (result.canceled || result.filePaths.length === 0) return null;
	const source = result.filePaths[0]!;
	if (statSync(source).size > MAX_ASSET_BYTES) throw new Error("That picture is larger than 10 MB. Shrink it first.");
	return pageImages.store(pageId, { fileName: basename(source), data: new Uint8Array(readFileSync(source)) });
}

/**
 * Opens a link from a page in the default browser or mail app. The address is
 * checked here, whatever the window sent: https and mailto only, so a page
 * cannot hand the shell a javascript: or file: address (security.md section 3).
 */
export async function openLink(url: string): Promise<void> {
	const href = safeLinkHref(String(url));
	if (!href) throw new Error("Juno only opens https and mail links from a page. Copy the address to use it elsewhere.");
	await shell.openExternal(href);
}
