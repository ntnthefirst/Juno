/**
 * The proportions of a stamp, shared by the placement page and the PDF writer
 * so what is dragged into place is what gets drawn.
 *
 * Everything scales with the width, so a stamp that is resized keeps its shape.
 * Units are whatever the width is in: CSS pixels in the window, points in the
 * file.
 */
export const STAMP_MIN_WIDTH = 0.08;
export const STAMP_MAX_WIDTH = 0.6;
export const STAMP_DEFAULT_WIDTH = 0.28;

/** An image never takes more than this share of the stamp's width in height. */
const MAX_IMAGE_HEIGHT_RATIO = 0.5;
/** Room for the name line and the date line when there is no image. */
const NAME_RATIO = 0.075;
/** "Ondertekend op 30/09/2026 om 10:25" has to fit the width, so this is the smaller line. */
const DATE_RATIO = 0.046;
const GAP_RATIO = 0.03;
const PADDING_RATIO = 0.03;

export interface StampMetrics {
	width: number;
	height: number;
	padding: number;
	imageHeight: number;
	nameSize: number;
	dateSize: number;
	gap: number;
}

/** `imageAspect` is height over width of the signature image, or null for none. */
export function stampMetrics(width: number, imageAspect: number | null): StampMetrics {
	const padding = width * PADDING_RATIO;
	const gap = width * GAP_RATIO;
	const nameSize = width * NAME_RATIO;
	const dateSize = width * DATE_RATIO;
	const innerWidth = width - padding * 2;
	const imageHeight =
		imageAspect === null ? 0 : Math.min(innerWidth * imageAspect, width * MAX_IMAGE_HEIGHT_RATIO);
	const height =
		padding * 2 +
		(imageHeight > 0 ? imageHeight + gap : 0) +
		nameSize * 1.2 +
		gap +
		dateSize * 1.2;
	return { width, height, padding, imageHeight, nameSize, dateSize, gap };
}

export function clampPlacement<T extends { x: number; y: number; width: number }>(
	placement: T,
	imageAspect: number | null,
	pageAspect: number,
): T {
	const width = Math.min(STAMP_MAX_WIDTH, Math.max(STAMP_MIN_WIDTH, placement.width));
	// Height as a fraction of the page height: width fraction times page width,
	// divided by page height, which is why the page height over width is needed.
	const heightFraction = stampMetrics(width, imageAspect).height / pageAspect;
	return {
		...placement,
		width,
		x: Math.min(1 - width, Math.max(0, placement.x)),
		y: Math.min(Math.max(0, 1 - heightFraction), Math.max(0, placement.y)),
	};
}
