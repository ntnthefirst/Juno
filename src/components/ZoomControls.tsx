import type { PreviewZoom } from "../lib/use-preview-zoom";
import { IconAction } from "./IconAction";

type ZoomControlsProps = {
	zoom: PreviewZoom;
	/** What fit makes the file: "Fit width" for a page, "Fit to the window" for a picture, "Actual size" for text. */
	fitLabel?: string;
};

/**
 * Zoom out, the percentage, zoom in and fit, at the right of a preview's
 * toolbar (decision 83). The percentage is announced as it changes.
 */
export function ZoomControls({ zoom, fitLabel = "Fit width" }: ZoomControlsProps) {
	return (
		<div className="flex shrink-0 items-center gap-1" data-zoom-controls>
			<IconAction icon="minus" label="Zoom out" tooltip="bottom" disabled={!zoom.canOut} onClick={zoom.zoomOut} />
			<span aria-live="polite" data-zoom-label className="tabular w-12 text-center text-sm text-[var(--ink-muted)]">
				{zoom.label}
			</span>
			<IconAction icon="add" label="Zoom in" tooltip="bottom" disabled={!zoom.canIn} onClick={zoom.zoomIn} />
			<IconAction icon="fit-width" label={fitLabel} tooltip="bottom" disabled={zoom.zoom.fit} onClick={zoom.fit} />
		</div>
	);
}
