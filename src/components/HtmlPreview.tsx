import { useRef } from "react";
import { usePreviewZoom } from "../lib/use-preview-zoom";
import { ZoomControls } from "./ZoomControls";

type HtmlPreviewProps = {
	/** An `app://preview/` address, for a frame with an empty sandbox. */
	url: string;
	name: string;
};

/**
 * A Word file as its HTML (decision 76), when Word is not there to make a PDF
 * of it (decision 83). The frame runs nothing and lets nothing out; its text
 * is selected and copied inside it as in any page, and the zoom scales the
 * whole of it.
 */
export function HtmlPreview({ url, name }: HtmlPreviewProps) {
	const area = useRef<HTMLDivElement>(null);
	const zoom = usePreviewZoom(1, area);
	return (
		<div className="animate-fade flex h-full min-h-0 flex-col">
			<div className="flex h-[48px] shrink-0 items-center justify-end gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
				<ZoomControls zoom={zoom} fitLabel="Actual size" />
			</div>
			<div ref={area} className="min-h-0 flex-1 bg-[var(--sunken)] p-6">
				<iframe
					title={name}
					src={url}
					sandbox=""
					referrerPolicy="no-referrer"
					data-html-preview
					style={{ zoom: zoom.scale }}
					className="mx-auto block h-full w-full max-w-[860px] rounded-[var(--radius-sm)] border border-[var(--line)] shadow-[var(--shadow-popover)]"
				/>
			</div>
		</div>
	);
}
