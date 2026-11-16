import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { messageOf } from "../lib/errors";
import { openPdf, type PDFDocumentProxy } from "../lib/pdf";
import { usePreviewZoom } from "../lib/use-preview-zoom";
import { PdfPageView } from "./PdfPageView";
import { PreviewFind } from "./PreviewFind";
import { ZoomControls } from "./ZoomControls";

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

/** A page's size in CSS pixels at 100%, from its size in points. */
type PageSize = { width: number; height: number };

/** Tagged with the file it belongs to, so a stale one is never shown for a new key. */
type Opened = { fileKey: string; pdf: PDFDocumentProxy; sizes: PageSize[] };
type Failure = { fileKey: string; message: string };
type Reading = { fileKey: string; page: number };

/** A point is 1/72 of an inch and a CSS pixel 1/96, so 100% is the page at its printed size. */
const PX_PER_PT = 96 / 72;
/** At fit a page is as wide as the pane allows, up to a comfortable reading width. */
const MAX_FIT_WIDTH = 900;
const GUTTER = 48;

/**
 * A PDF to read, one page after another on a sunken ground, with a toolbar
 * for where you are ("Page 2 of 7") and the zoom (decision 83). Each page is
 * drawn on a canvas and again, sharp, at every zoom, with its text laid over
 * it, so text is selected and copied as in any reader, and Ctrl or Cmd F
 * finds in every page.
 *
 * At fit a page is as wide as the pane allows, up to a comfortable reading
 * width; the percentage is the page against its printed size.
 */
export function PdfViewer({ fileKey, read, caption, empty }: PdfViewerProps) {
	const [loaded, setLoaded] = useState<Opened | null>(null);
	const [failure, setFailure] = useState<Failure | null>(null);
	const [paneWidth, setPaneWidth] = useState(0);
	const [reading, setReading] = useState<Reading | null>(null);
	const [finding, setFinding] = useState(false);
	const [textVersion, setTextVersion] = useState(0);
	const pane = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const scrolled = useRef(0);

	useEffect(() => {
		if (fileKey === null) return;
		let cancelled = false;
		let pdf: PDFDocumentProxy | null = null;
		(async () => {
			const bytes = await read(fileKey);
			pdf = await openPdf(bytes);
			const sizes: PageSize[] = [];
			for (let number = 1; number <= pdf.numPages; number += 1) {
				const view = (await pdf.getPage(number)).getViewport({ scale: 1 });
				sizes.push({ width: view.width * PX_PER_PT, height: view.height * PX_PER_PT });
			}
			if (!cancelled) setLoaded({ fileKey, pdf, sizes });
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
	const widest = opened ? Math.max(...opened.sizes.map((size) => size.width)) : 0;
	const fitWidth = Math.max(200, Math.min(MAX_FIT_WIDTH, paneWidth - GUTTER));
	const zoom = usePreviewZoom(widest > 0 ? fitWidth / widest : 1, pane);
	const scale = zoom.scale;

	// A zoom keeps the place being read: the same share of the way down.
	useLayoutEffect(() => {
		const element = pane.current;
		if (!element) return;
		element.scrollTop = scrolled.current * element.scrollHeight;
	}, [scale]);

	const textReady = useCallback(() => setTextVersion((value) => value + 1), []);

	function trackPage() {
		const element = pane.current;
		if (!element || fileKey === null) return;
		scrolled.current = element.scrollHeight > 0 ? element.scrollTop / element.scrollHeight : 0;
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
	const widestShown = Math.floor(widest * scale);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div className="flex h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
				<div className="min-w-0 truncate text-sm text-[var(--ink-muted)]">{caption}</div>
				{opened ? (
					<div className="flex shrink-0 items-center gap-3">
						<span className="tabular text-sm text-[var(--ink-muted)]" data-page-indicator>
							Page {current} of {count}
						</span>
						<ZoomControls zoom={zoom} />
					</div>
				) : null}
			</div>

			{opened ? (
				<PreviewFind container={pages} version={`${textVersion}:${scale}`} finding={finding} onFinding={setFinding} />
			) : null}

			<div ref={pane} onScroll={trackPage} className="min-h-0 flex-1 overflow-auto bg-[var(--sunken)]" data-pdf-pane>
				{fileKey === null ? (
					<div className="flex h-full items-center justify-center p-8 text-center">{empty}</div>
				) : error ? (
					<div className="m-6 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not open this PDF.</p>
						<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : !opened ? (
					<p className="p-8 text-[var(--ink-muted)]">Opening the PDF.</p>
				) : (
					<div ref={pages} className="flex flex-col items-center gap-4 p-4" style={{ minWidth: widestShown + 32 }}>
						{opened.sizes.map((size, index) => (
							<div key={index + 1} data-page={index + 1}>
								<PdfPageView
									pdf={opened.pdf}
									pageNumber={index + 1}
									width={Math.floor(size.width * scale)}
									aspect={size.height / size.width}
									selectable
									textEverywhere={finding}
									onText={textReady}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
