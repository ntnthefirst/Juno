import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type WheelEvent,
} from "react";
import type { MailBlock, MailLayout, TemplateInput } from "@shared/types";
import { CanvasView, type DropTarget, type Editing, type Measured, type Selection } from "./CanvasView";
import { PREVIEW_WIDTHS, type PreviewWidth } from "./preview-width";
import { isTyping, keysFor, shortcutFor } from "./shortcuts";
import { WidthSwitch } from "./WidthSwitch";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;

type CanvasStageProps = {
	layout: MailLayout;
	inputs: TemplateInput[];
	selection: Selection;
	onSelect: (selection: Selection) => void;
	onDrop: (fromSectionId: string, blockId: string, target: DropTarget) => void;
	onEdit: (sectionId: string, blockId: string, patch: Partial<MailBlock>) => void;
	editing: Editing | null;
	onEditing: (editing: Editing | null) => void;
	onMeasure: (size: Measured | null) => void;
	/** Commits a dragged height. */
	onHeight: (height: number) => void;
	contentHeight: number;
	onContentHeight: (height: number) => void;
	/** Held by the editor, so the canvas and the rendered message agree. */
	preview: PreviewWidth;
	onPreview: (width: PreviewWidth) => void;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * The surface the frame sits on: the width being previewed, the zoom, and the
 * handle that makes the sheet taller.
 *
 * It scrolls rather than floating the frame at a coordinate, so a trackpad,
 * a wheel and a scrollbar all behave the way they do everywhere else, and
 * dragging with the middle button or with space held pans the same view.
 */
export function CanvasStage({
	layout,
	inputs,
	selection,
	onSelect,
	onDrop,
	onEdit,
	editing,
	onEditing,
	onMeasure,
	onHeight,
	contentHeight,
	onContentHeight,
	preview,
	onPreview,
}: CanvasStageProps) {
	const [zoom, setZoom] = useState(1);
	// Whether the zoom is the author's rather than the one the stage picked. A
	// window that is resized should not undo a zoom somebody chose.
	const zoomed = useRef(false);
	const [panning, setPanning] = useState(false);
	const [spaceHeld, setSpaceHeld] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
	const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	// Whether the last press moved the view, so letting go after a pan does not
	// also let go of what is selected.
	const panned = useRef(false);
	const drag = useRef<{ y: number; from: number } | null>(null);
	// The unscaled height of the sheet with its label and handle, which the
	// outer box multiplies by the zoom to take the right amount of room.
	const sheetRef = useRef<HTMLDivElement>(null);
	const [sheet, setSheet] = useState(0);

	useEffect(() => {
		const element = sheetRef.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setSheet(element.offsetHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const width = Math.min(layout.width, PREVIEW_WIDTHS[preview]);
	const floor = Math.ceil(contentHeight);
	const height = Math.max(layout.minHeight, floor);

	/** The zoom at which the whole sheet is on screen, never past 100%. */
	const fit = useCallback(() => {
		const element = scroller.current;
		if (!element) return;
		// The padding the scroller carries on both sides.
		const room = element.clientWidth - 48;
		if (room <= 0) return;
		setZoom(clamp(Math.min(1, room / width), ZOOM_MIN, ZOOM_MAX));
	}, [width]);

	// Space turns the whole surface into something to drag, which is what every
	// canvas does and what a hand reaches for without being told. The zoom keys
	// are Figma's, and they are taken here before the window's own zoom, which
	// would scale the panels along with the sheet.
	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			// Not while somebody is typing a space, or a minus, into a field.
			if (event.defaultPrevented || isTyping(event.target)) return;
			if (document.querySelector("[role='dialog']")) return;
			if (event.code === "Space") {
				event.preventDefault();
				setSpaceHeld(true);
				return;
			}
			const action = shortcutFor(event);
			if (action === "zoom-in" || action === "zoom-out") {
				event.preventDefault();
				zoomed.current = true;
				setZoom((current) => clamp(current + (action === "zoom-in" ? 0.1 : -0.1), ZOOM_MIN, ZOOM_MAX));
			} else if (action === "zoom-reset") {
				event.preventDefault();
				zoomed.current = true;
				setZoom(1);
			} else if (action === "zoom-fit") {
				event.preventDefault();
				zoomed.current = false;
				fit();
			}
		};
		const up = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		const blur = () => setSpaceHeld(false);
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", blur);
		};
	}, [fit]);

	const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		zoomed.current = true;
		setZoom((current) => clamp(current - event.deltaY / 500, ZOOM_MIN, ZOOM_MAX));
	}, []);

	// A sheet wider than the room it has opens zoomed out rather than opening
	// half off the side with a scrollbar under it.
	useEffect(() => {
		const element = scroller.current;
		if (!element) return;
		const run = () => {
			if (!zoomed.current) fit();
		};
		run();
		const observer = new ResizeObserver(run);
		observer.observe(element);
		return () => observer.disconnect();
	}, [fit]);

	const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
		const wanted = event.button === 1 || (event.button === 0 && spaceHeld);
		if (!wanted || !scroller.current) return;
		event.preventDefault();
		panned.current = false;
		pan.current = {
			x: event.clientX,
			y: event.clientY,
			left: scroller.current.scrollLeft,
			top: scroller.current.scrollTop,
		};
		setPanning(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = pan.current;
		if (!start || !scroller.current) return;
		panned.current = true;
		scroller.current.scrollLeft = start.left - (event.clientX - start.x);
		scroller.current.scrollTop = start.top - (event.clientY - start.y);
	};

	const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!pan.current) return;
		pan.current = null;
		setPanning(false);
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		drag.current = { y: event.clientY, from: height };
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const start = drag.current;
		if (!start) return;
		// Divided by the zoom, so the sheet follows the pointer rather than
		// running away from it at anything other than 100%.
		onHeight(Math.max(floor, Math.round(start.from + (event.clientY - start.y) / zoom)));
	};

	const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!drag.current) return;
		drag.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--sunken)]">
			<div className="flex h-[36px] flex-none items-center gap-2 px-3">
				<div className="flex-1" />
				<WidthSwitch value={preview} onChange={onPreview} />
				<div className="flex flex-1 items-center justify-end gap-1">
					<button
						type="button"
						aria-label="Zoom out"
						title={`Zoom out (${keysFor("Zoom out")})`}
						onClick={() => {
							zoomed.current = true;
							setZoom((current) => clamp(current - 0.1, ZOOM_MIN, ZOOM_MAX));
						}}
						className="flex h-[28px] w-[28px] items-center justify-center rounded-[var(--radius-sm)] text-[length:var(--text-base)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<span aria-hidden>-</span>
					</button>
					<button
						type="button"
						onClick={() => {
							zoomed.current = false;
							fit();
						}}
						title={`Fit the sheet (${keysFor("Zoom to fit")})`}
						className="tabular h-[28px] rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						{Math.round(zoom * 100)}%
					</button>
					<button
						type="button"
						aria-label="Zoom in"
						title={`Zoom in (${keysFor("Zoom in")})`}
						onClick={() => {
							zoomed.current = true;
							setZoom((current) => clamp(current + 0.1, ZOOM_MIN, ZOOM_MAX));
						}}
						className="flex h-[28px] w-[28px] items-center justify-center rounded-[var(--radius-sm)] text-[length:var(--text-base)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<span aria-hidden>+</span>
					</button>
				</div>
			</div>

			<div
				ref={scroller}
				onWheel={onWheel}
				onPointerDown={startPan}
				onPointerMove={movePan}
				onPointerUp={endPan}
				onPointerCancel={endPan}
				// A click on the empty surface round the sheet lets go of what is
				// selected, as it does in Figma. Blocks and sections keep their
				// own clicks, so only the surface and the sheet's margin get here.
				onClick={(event) => {
					if (panned.current) {
						panned.current = false;
						return;
					}
					if (event.target instanceof Element && event.target.closest("button")) return;
					onSelect(null);
				}}
				role="presentation"
				className={`min-h-0 flex-1 overflow-auto px-6 pb-24 ${
					panning ? "cursor-grabbing" : spaceHeld ? "cursor-grab" : ""
				}`}
			>
				{/* The outer box takes the room the sheet takes at this zoom, so the
				    scrollbars measure what is on screen. The inner one is laid out at
				    the sheet's real width and only then scaled, so the label and the
				    handle line up with the sheet at every zoom. */}
				<div className="mx-auto" style={{ width: width * zoom, height: sheet * zoom }}>
					<div
						ref={sheetRef}
						className="flex flex-col"
						style={{ width, transform: `scale(${zoom})`, transformOrigin: "top left" }}
					>
						<p className="tabular pb-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
							{width} x {height}
						</p>

						<CanvasView
							layout={layout}
							inputs={inputs}
							width={width}
							selection={selection}
							onSelect={onSelect}
							onDrop={onDrop}
							onEdit={onEdit}
							editing={editing}
							onEditing={onEditing}
							onContentHeight={onContentHeight}
							onMeasure={onMeasure}
						/>

						<button
							type="button"
							aria-label="Drag to change the height of the sheet"
							title="Drag to change the height of the sheet"
							onPointerDown={startResize}
							onPointerMove={moveResize}
							onPointerUp={endResize}
							onPointerCancel={endResize}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") onHeight(Math.max(floor, height + 8));
								if (event.key === "ArrowUp") onHeight(Math.max(floor, height - 8));
							}}
							className="flex h-[32px] w-full cursor-ns-resize items-center justify-center rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						>
							<span className="h-[3px] w-[48px] rounded-full bg-[var(--line-strong)]" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
