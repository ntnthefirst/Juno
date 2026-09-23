import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DocumentLayout, LayoutBox, LayoutPage, PageMargin } from "@shared/types";
import { A4_HEIGHT_MM, A4_WIDTH_MM, clampBox, mmToPx, pxToMm, snap } from "../../../lib/page-geometry";
import { BlockView } from "./BlockView";
import { BLOCK_KIND_LABELS } from "./layout-actions";

export type CanvasSelection =
	| { kind: "block"; pageId: string; blockId: string }
	| { kind: "box"; pageId: string; boxId: string }
	| null;

type PageCanvasProps = {
	layout: DocumentLayout;
	/** "fit" resolves against the scroll container's own width, computed here. */
	zoom: "fit" | number;
	selection: CanvasSelection;
	onSelect: (selection: CanvasSelection) => void;
	/** Which page a new block or box is added to. */
	activePageId: string;
	onActivatePage: (pageId: string) => void;
	onMoveBox: (pageId: string, boxId: string, xMm: number, yMm: number) => void;
};

const MIN_FIT_ZOOM = 0.2;
const CANVAS_PADDING_PX = 48;

/**
 * The pages, drawn at true A4 proportions and scaled visually with a CSS
 * transform rather than by resizing every mm value: a block's own size is set
 * in real `mm` units, the same unit the compiler in
 * electron/main/services/document-layout.ts uses, so what overruns here is
 * what overruns the PDF. Only the transform changes with the zoom control.
 */
export function PageCanvas({
	layout,
	zoom,
	selection,
	onSelect,
	activePageId,
	onActivatePage,
	onMoveBox,
}: PageCanvasProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(0);

	useEffect(() => {
		const node = scrollRef.current;
		if (!node) return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setContainerWidth(entry.contentRect.width);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const pageWidthPx = mmToPx(A4_WIDTH_MM, 1);
	const effectiveZoom =
		zoom === "fit"
			? Math.max(MIN_FIT_ZOOM, containerWidth > 0 ? (containerWidth - CANVAS_PADDING_PX * 2) / pageWidthPx : 1)
			: zoom;

	const contentHeightMm = A4_HEIGHT_MM - layout.margin.top - layout.margin.bottom;

	return (
		<div ref={scrollRef} className="h-full min-h-0 overflow-auto bg-[var(--sunken)] px-6 py-6">
			<div className="mx-auto flex w-fit flex-col items-center gap-6">
				{layout.pages.map((page, index) => (
					<PageView
						key={page.id}
						page={page}
						pageNumber={index + 1}
						margin={layout.margin}
						contentHeightMm={contentHeightMm}
						zoom={effectiveZoom}
						active={page.id === activePageId}
						selection={selection}
						onSelect={onSelect}
						onActivate={() => onActivatePage(page.id)}
						onMoveBox={onMoveBox}
					/>
				))}
			</div>
		</div>
	);
}

type PageViewProps = {
	page: LayoutPage;
	pageNumber: number;
	margin: PageMargin;
	contentHeightMm: number;
	zoom: number;
	active: boolean;
	selection: CanvasSelection;
	onSelect: (selection: CanvasSelection) => void;
	onActivate: () => void;
	onMoveBox: (pageId: string, boxId: string, xMm: number, yMm: number) => void;
};

function PageView({
	page,
	pageNumber,
	margin,
	contentHeightMm,
	zoom,
	active,
	selection,
	onSelect,
	onActivate,
	onMoveBox,
}: PageViewProps) {
	const flowRef = useRef<HTMLDivElement>(null);
	const [overrun, setOverrun] = useState(false);

	// scrollHeight reads the element's own untransformed box, so this measures
	// the true, zoom-independent height even though the page around it is
	// visually scaled. That is what makes the warning honest at every zoom.
	useEffect(() => {
		const node = flowRef.current;
		if (!node) return;
		const limitPx = mmToPx(contentHeightMm, 1);
		const check = () => setOverrun(node.scrollHeight > limitPx + 1);
		check();
		const observer = new ResizeObserver(check);
		observer.observe(node);
		return () => observer.disconnect();
	}, [contentHeightMm, page.blocks]);

	const widthPx = mmToPx(A4_WIDTH_MM, zoom);
	const heightPx = mmToPx(A4_HEIGHT_MM, zoom);

	return (
		<div className="flex flex-col items-center gap-1.5">
			<div style={{ width: widthPx, height: heightPx }} className="relative shrink-0">
				<div
					style={{
						width: "210mm",
						height: "297mm",
						transform: `scale(${zoom})`,
						transformOrigin: "top left",
						padding: `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`,
					}}
					className={`absolute left-0 top-0 box-border overflow-hidden bg-[var(--canvas-paper)] shadow-[var(--shadow-popover)] ${
						active ? "outline outline-2 outline-offset-2 outline-[var(--accent)]" : ""
					}`}
				>
					{/* The margin guide: a hairline, not a heavy border, drawn exactly at
					    the page's own padding edge, which is the print margin. */}
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 border border-dashed border-[var(--line-strong)]"
					/>

					<button
						type="button"
						onClick={() => {
							onActivate();
							onSelect(null);
						}}
						aria-label={`Page ${pageNumber}, use as the target for new blocks`}
						aria-pressed={active}
						className="absolute inset-0 h-full w-full cursor-default bg-transparent p-0"
					/>

					<div ref={flowRef} className="relative flex flex-col gap-[3mm]">
						{page.blocks.map((block) => {
							const isSelected =
								selection?.kind === "block" && selection.pageId === page.id && selection.blockId === block.id;
							return (
								<button
									key={block.id}
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onActivate();
										onSelect({ kind: "block", pageId: page.id, blockId: block.id });
									}}
									aria-label={`${BLOCK_KIND_LABELS[block.kind]} block`}
									aria-pressed={isSelected}
									className={`block w-full cursor-pointer rounded-[2px] p-0 text-left outline outline-1 ${
										isSelected ? "outline-2 outline-[var(--accent)]" : "outline-transparent hover:outline-[var(--line-strong)]"
									}`}
								>
									<BlockView block={block} />
								</button>
							);
						})}
					</div>

					{page.boxes.map((box) => (
						<BoxHandle
							key={box.id}
							box={box}
							zoom={zoom}
							selected={selection?.kind === "box" && selection.pageId === page.id && selection.boxId === box.id}
							onSelect={() => {
								onActivate();
								onSelect({ kind: "box", pageId: page.id, boxId: box.id });
							}}
							onMove={(xMm, yMm) => onMoveBox(page.id, box.id, xMm, yMm)}
						/>
					))}
				</div>
			</div>

			{overrun ? (
				<p role="alert" className="max-w-[210mm] text-[length:var(--text-sm)] text-[var(--risk)]">
					Page {pageNumber} overruns. Content past the bottom of the page will not be printed.
				</p>
			) : (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Page {pageNumber}</p>
			)}
		</div>
	);
}

type BoxHandleProps = {
	box: LayoutBox;
	zoom: number;
	selected: boolean;
	onSelect: () => void;
	onMove: (xMm: number, yMm: number) => void;
};

type DragState = {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startXMm: number;
	startYMm: number;
};

/**
 * A box placed on the page. Dragging it is the mouse path; the inspector's
 * x/y fields are the accessible path, because a pointer drag has no keyboard
 * equivalent here (styling.md section 7).
 */
function BoxHandle({ box, zoom, selected, onSelect, onMove }: BoxHandleProps) {
	const dragRef = useRef<DragState | null>(null);

	function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
		onSelect();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startXMm: box.xMm,
			startYMm: box.yMm,
		};
	}

	function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const deltaXMm = pxToMm(event.clientX - drag.startClientX, zoom);
		const deltaYMm = pxToMm(event.clientY - drag.startClientY, zoom);
		const next = clampBox({
			xMm: snap(drag.startXMm + deltaXMm, 1),
			yMm: snap(drag.startYMm + deltaYMm, 1),
			widthMm: box.widthMm,
		});
		onMove(next.xMm, next.yMm);
	}

	function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
		if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
	}

	return (
		<button
			type="button"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onClick={(event) => event.stopPropagation()}
			aria-label={`${BLOCK_KIND_LABELS[box.block.kind]} box, placed ${box.xMm} millimetres from the left and ${box.yMm} millimetres from the top. Drag to move, or use the position fields in the inspector`}
			aria-pressed={selected}
			style={{
				position: "absolute",
				left: `${box.xMm}mm`,
				top: `${box.yMm}mm`,
				width: `${box.widthMm}mm`,
				touchAction: "none",
			}}
			className={`cursor-move rounded-[2px] bg-[var(--canvas-paper)]/95 p-0 text-left outline outline-2 ${
				selected ? "outline-[var(--accent)]" : "outline-dashed outline-[var(--line-strong)]"
			}`}
		>
			<BlockView block={box.block} />
		</button>
	);
}
