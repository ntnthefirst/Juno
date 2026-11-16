/**
 * pdf.js, loaded when the first PDF is opened. It renders a PDF to a canvas so
 * a stamp can be placed on the real page, and it is large, so it stays out of
 * the bundle every screen pays for. Nothing here writes to a PDF: that happens
 * in the main process, from the fractions the placement page reports.
 *
 * The worker is a bundled asset on the app's own origin, so the content policy
 * needs nothing beyond `'self'`.
 */
import type { PDFPageProxy } from "pdfjs-dist";

export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * pdf.js transfers the buffer it is given, so it gets a copy.
 *
 * Errors only. At its default level pdf.js warns about every font it has to
 * substitute and every newer JavaScript feature the bundled Chromium lacks, and
 * falls back correctly each time. Those warnings reach the console of a file
 * that renders perfectly, and the smoke run treats any console output from the
 * renderer as a failure.
 */
export async function openPdf(data: Uint8Array) {
	const [pdfjs, worker] = await Promise.all([
		import("pdfjs-dist"),
		import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	return pdfjs.getDocument({ data: data.slice(), verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
}

/**
 * A page's text as pdf.js lays it over the drawn page, transparent, so it can
 * be selected, copied and found (decision 83). `container` is emptied first.
 * `scale` is the page's CSS pixels over its points. Resolves when the text is
 * in place; the returned `cancel` stops one still being laid out.
 */
export function renderTextLayer(
	page: PDFPageProxy,
	container: HTMLElement,
	scale: number,
): { done: Promise<void>; cancel: () => void } {
	let cancelled = false;
	let layer: { cancel: () => void } | null = null;
	const done = import("pdfjs-dist").then(async (pdfjs) => {
		if (cancelled) return;
		container.replaceChildren();
		container.style.setProperty("--total-scale-factor", String(scale));
		const viewport = page.getViewport({ scale });
		const text = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
		layer = text;
		await text.render();
		// Where a drag past the last line lands, so selecting to the end of a page does not jump.
		const end = document.createElement("div");
		end.className = "endOfContent";
		container.append(end);
	});
	return {
		done: done.catch(() => undefined),
		cancel: () => {
			cancelled = true;
			layer?.cancel();
		},
	};
}
