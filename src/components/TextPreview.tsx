import { useRef, useState, type ReactNode } from "react";
import { usePreviewZoom } from "../lib/use-preview-zoom";
import { PreviewFind } from "./PreviewFind";
import { ZoomControls } from "./ZoomControls";

type TextPreviewProps = {
	text: string;
	/** Code and data keep their columns in a fixed-width face; prose reads in the interface's. */
	monospace?: boolean;
	/** Drawn above the text, inside what scrolls, such as a document's cover picture. */
	before?: ReactNode;
	/** One line under the text, such as that only its start is shown. */
	note?: ReactNode;
};

/**
 * Words to read in a file's preview (decision 83): selectable and copied as
 * text, found with Ctrl or Cmd F, and zoomed by scaling the type, so the
 * lines wrap again at every size and never run off the side.
 */
export function TextPreview({ text, monospace = true, before, note }: TextPreviewProps) {
	const area = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [finding, setFinding] = useState(false);
	const zoom = usePreviewZoom(1, area);
	return (
		<div className="animate-fade relative flex h-full min-h-0 flex-col bg-[var(--surface)]">
			<div className="flex h-[48px] shrink-0 items-center justify-end gap-3 border-b border-[var(--line)] px-4">
				<ZoomControls zoom={zoom} fitLabel="Actual size" />
			</div>
			<PreviewFind container={body} version={`${zoom.scale}:${text.length}`} finding={finding} onFinding={setFinding} />
			<div ref={area} className="min-h-0 flex-1 overflow-auto">
				<div ref={body} style={{ zoom: zoom.scale }} className="px-8 py-6">
					{before}
					<pre
						data-selectable
						className={`whitespace-pre-wrap text-[var(--ink)] ${monospace ? "font-mono text-dense" : "mx-auto max-w-[72ch] font-sans text-document"}`}
					>
						{text}
					</pre>
				</div>
			</div>
			{note ? <p className="flex-none border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-muted)]">{note}</p> : null}
		</div>
	);
}
