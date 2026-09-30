import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { PDFDocumentProxy } from "../../lib/pdf";

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
	/** Drawn over the page, in the same pixel space. */
	children?: ReactNode;
};

/**
 * One page of a PDF on a canvas. It paints when it first comes near the
 * viewport, so a long document does not render forty pages before the first
 * is on screen.
 */
export function PdfPageView({ pdf, pageNumber, width, aspect, onPlace, children }: PdfPageViewProps) {
	const holder = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [near, setNear] = useState(false);
	const height = width * aspect;

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
		void pdf.getPage(pageNumber).then((page) => {
			const target = canvas.current;
			if (cancelled || !target) return;
			const ratio = window.devicePixelRatio || 1;
			const base = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: (width / base.width) * ratio });
			target.width = Math.floor(viewport.width);
			target.height = Math.floor(viewport.height);
			task = page.render({ canvas: target, viewport });
			task.promise.catch(() => {
				// A cancelled render rejects, which is what cleanup asked for.
			});
		});
		return () => {
			cancelled = true;
			task?.cancel();
		};
	}, [pdf, pageNumber, width, near]);

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
			{children}
		</div>
	);
}
