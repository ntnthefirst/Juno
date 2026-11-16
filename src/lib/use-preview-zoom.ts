import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
	canZoomIn,
	canZoomOut,
	FIT,
	scaleOf,
	zoomByWheel,
	zoomCommandFor,
	zoomIn,
	zoomLabel,
	zoomOut,
	type Zoom,
} from "./preview-zoom";

export type PreviewZoom = {
	zoom: Zoom;
	/** The scale on screen now, fit included. */
	scale: number;
	label: string;
	canIn: boolean;
	canOut: boolean;
	zoomIn: () => void;
	zoomOut: () => void;
	fit: () => void;
	/** For a viewer that zooms around a point of its own, such as a picture under the pointer. */
	set: (zoom: Zoom) => void;
};

/** A key pressed in one of these is the field's. */
function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
	);
}

/**
 * The zoom of one file's preview (decision 83). Ctrl or Cmd with the wheel
 * over `area` zooms, and so do Ctrl or Cmd with plus, minus and 0 while the
 * preview is open, 0 going back to fit. `fitScale` is what fit stands for in
 * this viewer right now, so fit follows the window as it is resized.
 *
 * Each viewer has its own, and starts at fit, so the next file opens the way
 * the first one did.
 */
export function usePreviewZoom(fitScale: number, area: RefObject<HTMLElement | null>): PreviewZoom {
	const [zoom, setZoom] = useState<Zoom>(FIT);
	const fitRef = useRef(fitScale);
	useEffect(() => {
		fitRef.current = fitScale;
	});

	const apply = useCallback((change: (zoom: Zoom, fit: number) => Zoom) => {
		setZoom((current) => change(current, fitRef.current));
	}, []);

	useEffect(() => {
		const element = area.current;
		if (!element) return;
		function onWheel(event: WheelEvent) {
			if (!(event.ctrlKey || event.metaKey)) return;
			// The window would zoom itself otherwise.
			event.preventDefault();
			apply((current, fit) => zoomByWheel(current, fit, event.deltaY));
		}
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [area, apply]);

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented || isTyping(event.target)) return;
			// A question on top answers its own keys.
			if (document.querySelector("[role='dialog']")) return;
			const command = zoomCommandFor(event);
			if (!command) return;
			event.preventDefault();
			if (command === "in") apply(zoomIn);
			else if (command === "out") apply(zoomOut);
			else setZoom(FIT);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [apply]);

	const scale = scaleOf(zoom, fitScale);
	return {
		zoom,
		scale,
		label: zoomLabel(scale),
		canIn: canZoomIn(zoom, fitScale),
		canOut: canZoomOut(zoom, fitScale),
		zoomIn: () => apply(zoomIn),
		zoomOut: () => apply(zoomOut),
		fit: () => setZoom(FIT),
		set: setZoom,
	};
}
