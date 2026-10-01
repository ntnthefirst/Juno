import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconAction } from "./IconAction";
import { messageOf } from "../lib/errors";
import { openPdf, type PDFDocumentProxy } from "../lib/pdf";
import { PdfPageView } from "./PdfPageView";

type PdfViewerProps = {
	/** Changes when the file behind the viewer does, so the new one is opened. Null for no file. */
	fileKey: string | null;
	/** Reads the file for a key. Keep its identity stable, or the file is opened again. */
	read: (fileKey: string) => Promise<Uint8Array>;
	/** Drawn in the toolbar, left of the page and zoom controls. */
	caption?: ReactNode;
	/** Shown instead of a page when there is no file. */
	empty: ReactNode;
};

/** Tagged with the file it belongs to, so a stale one is never shown for a new key. */
type Opened = { fileKey: string; pdf: PDFDocumentProxy; aspects: number[] };
type Failure = { fileKey: string; message: string };
type Reading = { fileKey: string; page: number };

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const DEFAULT_ZOOM = 2;
const MAX_PAGE_WIDTH = 900;
const GUTTER = 48;

/**
 * A PDF to read, one page after another on a sunken ground, with a toolbar for
 * the page count and the zoom. It draws to a canvas, so text cannot be selected
 * here: the file opens outside for that.
 *
 * At 100% a page is as wide as the pane allows, up to a comfortable reading
 * width, and the zoom is a multiple of that.
 */
export function PdfViewer({ fileKey, read, caption, empty }: PdfViewerProps) {
	const [loaded, setLoaded] = useState<Opened | null>(null);
	const [failure, setFailure] = useState<Failure | null>(null);
	const [zoom, setZoom] = useState(DEFAULT_ZOOM);
	const [paneWidth, setPaneWidth] = useState(0);
	const [reading, setReading] = useState<Reading | null>(null);
	const pane = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (fileKey === null) return;
		let cancelled = false;
		let pdf: PDFDocumentProxy | null = null;
		(async () => {
			const bytes = await read(fileKey);
			pdf = await openPdf(bytes);
			const aspects: number[] = [];
			for (let number = 1; number <= pdf.numPages; number += 1) {
				const view = (await pdf.getPage(number)).getViewport({ scale: 1 });
				aspects.push(view.height / view.width);
			}
			if (!cancelled) setLoaded({ fileKey, pdf, aspects });
		})().catch((cause: unknown) => {
			if (!cancelled) setFailure({ fileKey, message: messageOf(cause) });
		});
		return () => {
			cancelled = true;
			void pdf?.loadingTask.destroy();
		};
	}, [fileKey, read]);

	useEffect(() => {
		const element = pane.current;
		if (!element) return;
		const measure = () => setPaneWidth(Math.floor(element.clientWidth));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const opened = loaded !== null && loaded.fileKey === fileKey ? loaded : null;
	const error = failure !== null && failure.fileKey === fileKey ? failure.message : null;
	const current = reading !== null && reading.fileKey === fileKey ? reading.page : 1;
	const fit = Math.max(200, Math.min(MAX_PAGE_WIDTH, paneWidth - GUTTER));
	const pageWidth = Math.floor(fit * ZOOMS[zoom]!);

	function trackPage() {
		const element = pane.current;
		if (!element || fileKey === null) return;
		const top = element.getBoundingClientRect().top;
		let nearest = 1;
		let best = Number.POSITIVE_INFINITY;
		element.querySelectorAll<HTMLElement>("[data-page]").forEach((page) => {
			const distance = Math.abs(page.getBoundingClientRect().top - top - 16);
			if (distance < best) {
				best = distance;
				nearest = Number(page.dataset.page);
			}
		});
		setReading({ fileKey, page: nearest });
	}

	const count = opened?.pdf.numPages ?? 0;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
				<div className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{caption}</div>
				{opened ? (
					<div className="flex shrink-0 items-center gap-1">
						<span className="tabular mr-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Page {current} of {count}
						</span>
						<IconAction
							icon="minus"
							label="Zoom out"
							disabled={zoom === 0}
							onClick={() => setZoom((value) => Math.max(0, value - 1))}
						/>
						<span className="tabular w-11 text-center text-[length:var(--text-sm)]">
							{Math.round(ZOOMS[zoom]! * 100)}%
						</span>
						<IconAction
							icon="add"
							label="Zoom in"
							disabled={zoom === ZOOMS.length - 1}
							onClick={() => setZoom((value) => Math.min(ZOOMS.length - 1, value + 1))}
						/>
					</div>
				) : null}
			</div>

			<div ref={pane} onScroll={trackPage} className="min-h-0 flex-1 overflow-auto bg-[var(--sunken)]">
				{fileKey === null ? (
					<div className="flex h-full items-center justify-center p-8 text-center">{empty}</div>
				) : error ? (
					<div className="m-6 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not open this PDF.</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : !opened ? (
					<p className="p-8 text-[var(--ink-muted)]">Opening the PDF.</p>
				) : (
					<div
						className="flex flex-col items-center gap-4 p-4"
						style={{ minWidth: pageWidth + 32 }}
					>
						{Array.from({ length: count }, (_, index) => index + 1).map((number) => (
							<div key={number} data-page={number}>
								<PdfPageView
									pdf={opened.pdf}
									pageNumber={number}
									width={pageWidth}
									aspect={opened.aspects[number - 1]!}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
