import type { ReactNode } from "react";
import type { FilePreviewSource } from "@shared/types";
import type { PreviewState } from "../lib/use-file-preview";
import { FileTypeIcon } from "./FileTypeIcon";
import { Button } from "./Button";
import { ImagePreview } from "./ImagePreview";
import { PdfBytesViewer } from "./PdfBytesViewer";
import { PreviewSkeleton } from "./PreviewSkeleton";
import { SheetPreview } from "./SheetPreview";

type FilePreviewViewProps = {
	state: PreviewState;
	/** Opens the file in its app, offered when there is nothing to show. Left out where it cannot be opened. */
	onOpen?: () => void;
	/** Drawn in the PDF viewer's toolbar. */
	caption?: ReactNode;
	/** What the preview was made from, so a picture can be copied from the same file, by id. */
	source?: FilePreviewSource;
};

/**
 * A file drawn by what it is (decision 76), from what the main process made
 * of it: a PDF in the viewer, a picture as a picture (an SVG through `<img>`
 * only, which runs nothing in it), a Word file as its HTML in a frame with an
 * empty sandbox, a spreadsheet as its cells, text as text, and anything else
 * by the picture Windows draws of it or a sentence saying why not.
 *
 * While the file is read the space holds the shape of a page, so nothing moves
 * when it lands.
 */
export function FilePreviewView({ state, onOpen, caption, source }: FilePreviewViewProps) {
	if (state.status === "loading") return <PreviewSkeleton />;
	if (state.status === "error") {
		return (
			<div className="flex h-full items-center justify-center bg-[var(--sunken)] p-8">
				<div className="max-w-[52ch] border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not show this file.</p>
					<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
						{state.message}
					</p>
					{onOpen ? (
						<div className="mt-3">
							<Button size="dense" onClick={onOpen}>
								Open in its app
							</Button>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	const { preview } = state;
	switch (preview.kind) {
		case "pdf":
			return <PdfBytesViewer name={preview.meta.name} data={preview.data} caption={caption} />;
		case "image": {
			// An SVG is a document, not a picture the clipboard takes.
			const copyable = source && preview.meta.extension !== "svg" ? source : null;
			return (
				<ImagePreview
					url={preview.url}
					name={preview.meta.name}
					{...(copyable ? { onCopy: () => window.juno.documents.clipboard.copyPicture(copyable) } : {})}
				/>
			);
		}
		case "html":
			return (
				<div className="animate-fade h-full bg-[var(--sunken)] p-6">
					<iframe
						title={preview.meta.name}
						src={preview.url}
						sandbox=""
						referrerPolicy="no-referrer"
						className="mx-auto block h-full w-full max-w-[860px] rounded-[var(--radius-sm)] border border-[var(--line)] shadow-[var(--shadow-popover)]"
					/>
				</div>
			);
		case "text":
			return (
				<div className="animate-fade flex h-full min-h-0 flex-col bg-[var(--surface)]">
					<pre
						data-selectable
						className="min-h-0 flex-1 overflow-auto px-8 py-6 font-mono text-dense whitespace-pre-wrap text-[var(--ink)]"
					>
						{preview.text}
					</pre>
					{preview.truncated ? (
						<p className="flex-none border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-muted)]">
							This is the first part of the file. Open it to read the rest.
						</p>
					) : null}
				</div>
			);
		case "table":
			return (
				<div className="animate-fade h-full">
					<SheetPreview sheets={preview.sheets} truncatedSheets={preview.truncatedSheets} />
				</div>
			);
		case "thumbnail":
			return (
				<div className="animate-fade flex h-full flex-col items-center justify-center gap-4 bg-[var(--sunken)] p-6">
					<img
						src={preview.url}
						alt={preview.meta.name}
						draggable={false}
						className="max-h-[70%] max-w-full rounded-[var(--radius-sm)] object-contain"
					/>
					<p className="max-w-[52ch] text-center text-sm text-[var(--ink-muted)]">
						{preview.from === "iwork"
							? "The picture this file carries of itself. Open it to see all of it."
							: "The picture Windows draws of this file. Open it to see all of it."}
					</p>
					{onOpen ? (
						<Button size="dense" onClick={onOpen}>
							Open in its app
						</Button>
					) : null}
				</div>
			);
		case "none":
			return (
				<div className="animate-fade flex h-full flex-col items-center justify-center gap-3 bg-[var(--sunken)] p-8 text-center">
					<span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface)]">
						<FileTypeIcon filename={preview.meta.name} mimeType={preview.meta.mediaType} size={28} />
					</span>
					<p className="text-base font-[var(--weight-medium)]">No preview for this file</p>
					<p className="max-w-[52ch] text-sm text-[var(--ink-muted)]">{preview.reason}</p>
					{onOpen ? (
						<Button size="dense" onClick={onOpen}>
							Open in its app
						</Button>
					) : null}
				</div>
			);
	}
}
