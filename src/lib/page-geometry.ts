/**
 * Geometry for the document page editor. Millimetres are the page model's
 * unit (electron/shared/types.ts, `Mm`), so every place that turns a
 * millimetre into a screen pixel, or a pixel delta from a drag back into
 * millimetres, goes through here. The canvas and the drag handler import the
 * same functions, so they cannot disagree about where a box actually is.
 *
 * A4 size is duplicated from electron/main/services/document-layout.ts
 * rather than imported: the renderer never reaches into electron/main
 * (architecture.md section 7), so the main process and the page editor each
 * carry their own copy of the one fact both need to agree on.
 */

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/**
 * CSS defines 1mm as 96/25.4 reference pixels, independent of the screen's
 * real DPI, which is the same rule a browser applies to an element sized
 * with the `mm` unit directly. Using it here rather than an invented ratio
 * means "100%" on the zoom control shows a page close to its printed size,
 * and a page at 210mm wide lands at roughly 794px, a normal on-screen size
 * for a document editor.
 */
const CSS_PX_PER_MM = 96 / 25.4;

/** A millimetre measurement at the given zoom, in on-screen pixels. */
export function mmToPx(mm: number, zoom: number): number {
	return mm * CSS_PX_PER_MM * zoom;
}

/** The inverse of mmToPx: an on-screen pixel measurement back to millimetres. */
export function pxToMm(px: number, zoom: number): number {
	return px / (CSS_PX_PER_MM * zoom);
}

/** Below this width or height, a box is not worth having: it stops reading
 * as a placed block and there is nothing left to grab with a pointer. */
export const MIN_BOX_WIDTH_MM = 10;
export const MIN_BOX_HEIGHT_MM = 5;

export type BoxRect = { xMm: number; yMm: number; widthMm: number };

/**
 * Keeps a box on the paper: its width never exceeds the page, and its
 * position never lets it drift off an edge. Height is not part of the model
 * a box carries (a box sizes to its block's own content), so this only
 * guards a minimum sliver of vertical room rather than the block's true
 * height, which is not knowable without rendering it.
 */
export function clampBox(box: BoxRect): BoxRect {
	const widthMm = Math.min(Math.max(box.widthMm, MIN_BOX_WIDTH_MM), A4_WIDTH_MM);
	const xMm = Math.min(Math.max(box.xMm, 0), A4_WIDTH_MM - widthMm);
	const yMm = Math.min(Math.max(box.yMm, 0), A4_HEIGHT_MM - MIN_BOX_HEIGHT_MM);
	return { xMm, yMm, widthMm };
}

/** Rounds a millimetre value to the nearest step, for a 1mm drag snap. */
export function snap(mm: number, stepMm: number): number {
	if (stepMm <= 0) return mm;
	return Math.round(mm / stepMm) * stepMm;
}
