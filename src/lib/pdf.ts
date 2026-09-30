/**
 * pdf.js, loaded when the first PDF is opened. It renders a PDF to a canvas so
 * a stamp can be placed on the real page, and it is large, so it stays out of
 * the bundle every screen pays for. Nothing here writes to a PDF: that happens
 * in the main process, from the fractions the placement page reports.
 *
 * The worker is a bundled asset on the app's own origin, so the content policy
 * needs nothing beyond `'self'`.
 */
export type { PDFDocumentProxy } from "pdfjs-dist";

/** pdf.js transfers the buffer it is given, so it gets a copy. */
export async function openPdf(data: Uint8Array) {
	const [pdfjs, worker] = await Promise.all([
		import("pdfjs-dist"),
		import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	return pdfjs.getDocument({ data: data.slice() }).promise;
}
