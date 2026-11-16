import { matchesCombo, type KeyLike } from "./shortcuts";

/**
 * How far a file's preview is zoomed (decision 83), the same for every kind
 * of file: a PDF, a picture, text, a table and a Word file shown as HTML.
 *
 * A zoom is either "fit", which follows the view as it is resized, or a
 * scale. A scale is measured against the file's own size: 100% is a PDF page
 * at its printed size, a picture pixel for pixel, and text at the size the
 * app sets it. What "fit" means is each viewer's to say, so every helper takes
 * the scale fit stands for at that moment.
 *
 * No browser in here, so every rule is tested in plain Node.
 */
export type Zoom = { fit: true } | { fit: false; scale: number };

export const FIT: Zoom = { fit: true };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** The scales Zoom in and Zoom out step through, as a document viewer's do. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** One notch of the wheel with Ctrl or Cmd held. */
const WHEEL_FACTOR = 1.1;

export function clampScale(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** The scale a zoom stands for, given what fit is right now. */
export function scaleOf(zoom: Zoom, fitScale: number): number {
	return zoom.fit ? clampScale(fitScale) : clampScale(zoom.scale);
}

/** The next step above where it is now. From fit, the next step above what fit is. */
export function zoomIn(zoom: Zoom, fitScale: number): Zoom {
	const now = scaleOf(zoom, fitScale);
	const next = ZOOM_STEPS.find((step) => step > now + 0.001) ?? MAX_ZOOM;
	return { fit: false, scale: next };
}

/** The next step below where it is now. */
export function zoomOut(zoom: Zoom, fitScale: number): Zoom {
	const now = scaleOf(zoom, fitScale);
	const next = [...ZOOM_STEPS].reverse().find((step) => step < now - 0.001) ?? MIN_ZOOM;
	return { fit: false, scale: next };
}

/** A turn of the wheel with Ctrl or Cmd held: up zooms in, down zooms out, a notch at a time. */
export function zoomByWheel(zoom: Zoom, fitScale: number, deltaY: number): Zoom {
	if (deltaY === 0) return zoom;
	const now = scaleOf(zoom, fitScale);
	return { fit: false, scale: clampScale(deltaY < 0 ? now * WHEEL_FACTOR : now / WHEEL_FACTOR) };
}

/** "125%". */
export function zoomLabel(scale: number): string {
	return `${Math.round(clampScale(scale) * 100)}%`;
}

export function canZoomIn(zoom: Zoom, fitScale: number): boolean {
	return scaleOf(zoom, fitScale) < MAX_ZOOM - 0.001;
}

export function canZoomOut(zoom: Zoom, fitScale: number): boolean {
	return scaleOf(zoom, fitScale) > MIN_ZOOM + 0.001;
}

/** The keys, as the shortcuts sheet draws them. `=` is drawn as plus. */
export const ZOOM_COMBOS = { in: "mod+=", out: "mod+-", fit: "mod+0" } as const;

export type ZoomCommand = "in" | "out" | "fit";

/**
 * What a key asks of the zoom, or null. Plus is the key that types `=` or `+`
 * and the one on the number pad, minus likewise, and 0 is read from the
 * physical key, because on a Belgian keyboard the unshifted 0 types `à`.
 */
export function zoomCommandFor(event: KeyLike, mac?: boolean): ZoomCommand | null {
	// The modifiers alone, checked the way every other shortcut checks them. Read
	// one by one: a KeyboardEvent keeps them as getters, which a spread drops.
	const modifiers = {
		key: "0",
		code: "Digit0",
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		altKey: event.altKey,
		shiftKey: false,
	};
	if (!matchesCombo(modifiers, ZOOM_COMBOS.fit, mac)) return null;
	if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return "in";
	if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") return "out";
	if (event.code === "Digit0" || event.code === "Numpad0") return "fit";
	return null;
}
