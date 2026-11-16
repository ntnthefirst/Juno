import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { renderTextLayer, type PDFDocumentProxy } from "../lib/pdf";

type PdfPageViewProps = {
	pdf: PDFDocumentProxy;
	pageNumber: number;
	/** Displayed width in CSS pixels. */
	width: number;
	/** Page height over page width, so the space is reserved before it paints. */
	aspect: number;
	/**
	 * Called with fractions of the page, measured from its top left. Left out for
	 * a page that is only read, which then has a plain cursor.
	 */
	onPlace?: (fraction: { x: number; y: number }) => void;
	/** Lays the page's text over it, so it can be selected, copied and found. */
	selectable?: boolean;
	/** Lays the text even while the page is far from view, for a search over every page. */
	textEverywhere?: boolean;
	/** Told each time this page's text is laid out, so a search can look again. */
	onText?: () => void;
	/** Drawn over the page, in the same pixel space. */
	children?: ReactNode;
};

/** How long a new width rests before the page is drawn again at it, so a turn of the wheel draws once. */
const REDRAW_AFTER_MS = 90;

/**
 * One page of a PDF on a canvas. It paints when it first comes near the
 * viewport, so a long document does not render forty pages before the first
 * is on screen, and again, sharp, at a new width once the zoom rests. The old
 * drawing stays, stretched, until the new one is ready, so a zoom never shows
 * a blank page.
 */
export function PdfPageView({
	pdf,
	pageNumber,
	width,
	aspect,
	onPlace,
	selectable = false,
	textEverywhere = false,
	onText,
	children,
}: PdfPageViewProps) {
	const holder = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const text = useRef<HTMLDivElement>(null);
	const drawn = useRef(false);
	const [near, setNear] = useState(false);
	const height = width * aspect;
	const told = useRef(onText);
	useEffect(() => {
		told.current = onText;
	});

	useEffect(() => {
		const element = holder.current;
		if (!element) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setNear(true);
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!near || width <= 0) return;
		let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
		let cancelled = false;
		const draw = () => {
			void pdf.getPage(pageNumber).then((page) => {
				const target = canvas.current;
				if (cancelled || !target) return;
				const ratio = window.devicePixelRatio || 1;
				const base = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({ scale: (width / base.width) * ratio });
				// Drawn aside and copied over in one step, so the page on screen is
				// never cleared while the sharper one is made.
				const fresh = document.createElement("canvas");
				fresh.width = Math.floor(viewport.width);
				fresh.height = Math.floor(viewport.height);
				task = page.render({ canvas: fresh, viewport });
				task.promise.then(
					() => {
						if (cancelled) return;
						target.width = fresh.width;
						target.height = fresh.height;
						target.getContext("2d")?.drawImage(fresh, 0, 0);
						drawn.current = true;
					},
					() => {
						// A cancelled render rejects, which is what cleanup asked for.
					},
				);
			});
		};
		// The first drawing goes at once; a new width waits for the zoom to rest.
		const timer = window.setTimeout(draw, drawn.current ? REDRAW_AFTER_MS : 0);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			task?.cancel();
		};
	}, [pdf, pageNumber, width, near]);

	const wantsText = selectable && (near || textEverywhere);
	useEffect(() => {
		const container = text.current;
		if (!wantsText || !container || width <= 0) return;
		let layer: { cancel: () => void } | null = null;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			void pdf.getPage(pageNumber).then((page) => {
				if (cancelled) return;
				const base = page.getViewport({ scale: 1 });
				const laid = renderTextLayer(page, container, width / base.width);
				layer = laid;
				void laid.done.then(() => {
					if (!cancelled) told.current?.();
				});
			});
		}, container.childElementCount > 0 ? REDRAW_AFTER_MS : 0);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			layer?.cancel();
		};
	}, [pdf, pageNumber, width, wantsText]);

	function place(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0 || !onPlace) return;
		const rect = event.currentTarget.getBoundingClientRect();
		onPlace({
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height,
		});
	}

	return (
		<div
			ref={holder}
			onPointerDown={place}
			style={{ width, height }}
			className={`relative overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--canvas-paper)] ${onPlace ? "cursor-crosshair" : ""}`}
		>
			<canvas ref={canvas} style={{ width, height }} className="block" />
			{selectable ? (
				<div
					ref={text}
					className="textLayer"
					onPointerDown={(event) => event.currentTarget.classList.add("selecting")}
					onPointerUp={(event) => event.currentTarget.classList.remove("selecting")}
					onPointerCancel={(event) => event.currentTarget.classList.remove("selecting")}
				/>
			) : null}
			{children}
		</div>
	);
}
