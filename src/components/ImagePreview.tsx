import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { announce } from "../lib/announce";
import { messageOf } from "../lib/errors";
import { matchesCombo } from "../lib/shortcuts";
import { usePreviewZoom } from "../lib/use-preview-zoom";
import { ContextMenu, type MenuItem } from "./Menu";
import { ZoomControls } from "./ZoomControls";

type ImagePreviewProps = {
	/** An `app://preview/` address, for an `<img>` only. */
	url: string;
	name: string;
	/** Puts the picture on the clipboard through the main process. Left out where it cannot be copied, such as an SVG. */
	onCopy?: () => Promise<void>;
};

type Size = { width: number; height: number };
type Drag = { x: number; y: number; left: number; top: number; id: number };
type Status = { tone: "ok" | "risk"; text: string } | null;

/** The space kept around a picture at fit. */
const MARGIN = 48;
const STATUS_MS = 2500;

/** A key pressed in one of these is the field's. */
function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
	);
}

/**
 * A picture to look at (decision 83). At fit it is as large as the view
 * allows and never larger than itself; zoomed past the view it is dragged to
 * pan, and the wheel scrolls it. Ctrl or Cmd C, or Copy picture in its
 * right-click menu, puts the picture on the clipboard. An SVG comes here
 * through `<img>` too, which runs nothing in it.
 */
export function ImagePreview({ url, name, onCopy }: ImagePreviewProps) {
	const area = useRef<HTMLDivElement>(null);
	const [natural, setNatural] = useState<Size | null>(null);
	const [view, setView] = useState<Size>({ width: 0, height: 0 });
	const [drag, setDrag] = useState<Drag | null>(null);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const [status, setStatus] = useState<Status>(null);
	const centre = useRef({ x: 0.5, y: 0.5 });

	useEffect(() => {
		const element = area.current;
		if (!element) return;
		const measure = () => setView({ width: element.clientWidth, height: element.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const fit =
		natural && view.width > 0
			? Math.min(1, (view.width - MARGIN) / natural.width, (view.height - MARGIN) / natural.height)
			: 1;
	const zoom = usePreviewZoom(fit, area);
	const width = natural ? Math.max(1, Math.round(natural.width * zoom.scale)) : undefined;
	const height = natural ? Math.max(1, Math.round(natural.height * zoom.scale)) : undefined;
	const pannable = width !== undefined && height !== undefined && (width > view.width || height > view.height);

	// A zoom keeps the middle of what was in view in the middle.
	useLayoutEffect(() => {
		const element = area.current;
		if (!element) return;
		element.scrollLeft = centre.current.x * element.scrollWidth - element.clientWidth / 2;
		element.scrollTop = centre.current.y * element.scrollHeight - element.clientHeight / 2;
	}, [zoom.scale]);

	function remember() {
		const element = area.current;
		if (!element || element.scrollWidth === 0) return;
		centre.current = {
			x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
			y: (element.scrollTop + element.clientHeight / 2) / element.scrollHeight,
		};
	}

	useEffect(() => {
		if (!status) return;
		const timer = window.setTimeout(() => setStatus(null), STATUS_MS);
		return () => window.clearTimeout(timer);
	}, [status]);

	const latestCopy = useRef(onCopy);
	useEffect(() => {
		latestCopy.current = onCopy;
	});

	const copy = useCallback(async () => {
		const run = latestCopy.current;
		if (!run) return;
		try {
			await run();
			setStatus({ tone: "ok", text: "Picture copied." });
			announce("Picture copied.");
		} catch (cause: unknown) {
			setStatus({ tone: "risk", text: messageOf(cause) });
		}
	}, []);

	// Ctrl C copies the picture, unless some text on the page is selected, which copies as text.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented || isTyping(event.target) || !latestCopy.current) return;
			if (!matchesCombo(event, "mod+c") || document.querySelector("[role='dialog']")) return;
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) return;
			event.preventDefault();
			void copy();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [copy]);

	function startPan(event: PointerEvent<HTMLDivElement>) {
		const element = area.current;
		if (event.button !== 0 || !pannable || !element) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrag({ x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, id: event.pointerId });
	}

	function pan(event: PointerEvent<HTMLDivElement>) {
		const element = area.current;
		if (!drag || !element || event.pointerId !== drag.id) return;
		element.scrollLeft = drag.left - (event.clientX - drag.x);
		element.scrollTop = drag.top - (event.clientY - drag.y);
	}

	const items: MenuItem[] = [
		...(onCopy ? [{ id: "copy", label: "Copy picture", icon: "copy" as const, hint: "Ctrl C", onSelect: () => void copy() }] : []),
		{ id: "fit", label: "Fit to the window", icon: "fit-width", separatorBefore: Boolean(onCopy), onSelect: zoom.fit },
		{ id: "actual", label: "Actual size", icon: "image", onSelect: () => zoom.set({ fit: false, scale: 1 }) },
	];

	return (
		<div className="animate-fade flex h-full min-h-0 flex-col">
			<div className="flex h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
				<p
					className={`min-w-0 truncate text-sm ${status?.tone === "risk" ? "text-[var(--risk)]" : "text-[var(--ink-muted)]"}`}
				>
					{status ? status.text : natural ? <span className="tabular">{`${natural.width} by ${natural.height} pixels`}</span> : null}
				</p>
				<ZoomControls zoom={zoom} fitLabel="Fit to the window" />
			</div>
			<div
				ref={area}
				onScroll={remember}
				onPointerDown={startPan}
				onPointerMove={pan}
				onPointerUp={() => setDrag(null)}
				onPointerCancel={() => setDrag(null)}
				onContextMenu={(event) => {
					event.preventDefault();
					setMenu({ x: event.clientX, y: event.clientY });
				}}
				data-image-preview
				className={`min-h-0 flex-1 overflow-auto bg-[var(--sunken)] ${pannable ? (drag ? "cursor-grabbing" : "cursor-grab") : ""}`}
			>
				<div className="grid min-h-full min-w-full place-items-center p-6" style={width ? { width: Math.max(width + MARGIN, 0) } : undefined}>
					<img
						src={url}
						alt={name}
						draggable={false}
						onLoad={(event) =>
							setNatural({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })
						}
						style={width && height ? { width, height } : undefined}
						className={`max-w-none rounded-[var(--radius-sm)] shadow-[var(--shadow-popover)] ${natural ? "" : "invisible"}`}
					/>
				</div>
			</div>
			{menu ? <ContextMenu at={menu} items={items} onClose={() => setMenu(null)} ariaLabel={`Picture ${name}`} /> : null}
		</div>
	);
}
