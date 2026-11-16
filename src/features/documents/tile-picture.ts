import type { FilePreviewSource } from "@shared/types";
import { openPdf } from "../../lib/pdf";

/**
 * What a tile shows of its file: a picture of it, or nothing, in which case
 * the tile draws the file's icon.
 *
 * A PDF is drawn once, page one at tile width, and kept as a small picture
 * rather than as the file's bytes, so a folder of contracts costs a few
 * kilobytes each and not the whole of every file. A picture or a thumbnail is
 * kept as the `app://preview/` address the main process handed out.
 *
 * At most three are read at a time, so opening a folder of two hundred files
 * does not queue two hundred reads in front of the preview the person clicks.
 */
export type TilePicture = { url: string } | null;

const WIDTH = 320;
const LIMIT = 3;
const KEEP = 200;

const kept = new Map<string, Promise<TilePicture>>();
const waiting: (() => void)[] = [];
let running = 0;

function next() {
	if (running >= LIMIT) return;
	const start = waiting.shift();
	if (!start) return;
	running += 1;
	start();
}

function queued<T>(work: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		waiting.push(() => {
			work()
				.then(resolve, reject)
				.finally(() => {
					running -= 1;
					next();
				});
		});
		next();
	});
}

async function pdfPicture(data: Uint8Array): Promise<TilePicture> {
	const pdf = await openPdf(data);
	try {
		const page = await pdf.getPage(1);
		const base = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({ scale: WIDTH / base.width });
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		await page.render({ canvas, viewport }).promise;
		return { url: canvas.toDataURL("image/png") };
	} finally {
		void pdf.loadingTask.destroy();
	}
}

async function read(source: FilePreviewSource): Promise<TilePicture> {
	// A tile never starts Word or PowerPoint: it takes their PDF only when a preview already made one.
	const preview = await window.juno.documents.preview(source, { convert: false });
	if (preview.kind === "image" || preview.kind === "thumbnail") return { url: preview.url };
	if (preview.kind === "iwork") return preview.cover ? { url: preview.cover } : null;
	if (preview.kind === "pdf") return pdfPicture(preview.data);
	return null;
}

/** The picture for one file, read once per key. A failure is a tile with an icon, not an error. */
export function tilePicture(key: string, source: FilePreviewSource): Promise<TilePicture> {
	const known = kept.get(key);
	if (known) return known;
	const made = queued(() => read(source)).catch(() => null);
	kept.set(key, made);
	while (kept.size > KEEP) {
		const oldest = kept.keys().next().value;
		if (oldest === undefined) break;
		kept.delete(oldest);
	}
	return made;
}

/** Forgets a picture whose address stopped answering, so the next look reads it again. */
export function forgetTilePicture(key: string): void {
	kept.delete(key);
}
