import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { StampPlacement } from "@shared/types";
import { clampPlacement, stampMetrics } from "@shared/stamp";
import { FitText } from "./FitText";

type StampBoxProps = {
	placement: StampPlacement;
	/** Displayed size of the page the stamp is on, in CSS pixels. */
	pageWidth: number;
	pageHeight: number;
	/** The signature image, or null when the stamp has none. */
	image: { url: string; aspect: number } | null;
	name: string;
	dateText: string;
	onChange: (next: StampPlacement) => void;
	onNameChange: (name: string) => void;
};

/**
 * The stamp as it will be drawn, on the page it will be drawn on. It is built
 * from the same proportions the PDF writer uses (shared/stamp.ts), so what is
 * dragged into place is what ends up in the file.
 *
 * Pointer events do the dragging, and the arrow keys do the same for someone
 * without a pointer: an arrow moves it by one percent, shift by five, and plus
 * and minus resize it. The name is changed where it is drawn, by a double
 * click on the stamp or Enter on it.
 */
export function StampBox({
	placement,
	pageWidth,
	pageHeight,
	image,
	name,
	dateText,
	onChange,
	onNameChange,
}: StampBoxProps) {
	const [editing, setEditing] = useState<string | null>(null);
	const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; from: StampPlacement } | null>(null);
	const imageAspect = image ? image.aspect : null;
	const pageAspect = pageHeight / pageWidth;
	const metrics = stampMetrics(placement.width * pageWidth, imageAspect);

	const inner = metrics.width - metrics.padding * 2;

	function commit(next: StampPlacement) {
		onChange(clampPlacement(next, imageAspect, pageAspect));
	}

	function begin(event: PointerEvent<HTMLElement>, mode: "move" | "resize") {
		if (event.button !== 0) return;
		// The page underneath moves the stamp on a press. Not while it is held.
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { mode, x: event.clientX, y: event.clientY, from: placement };
	}

	function move(event: PointerEvent<HTMLElement>) {
		const state = drag.current;
		if (!state) return;
		const dx = (event.clientX - state.x) / pageWidth;
		const dy = (event.clientY - state.y) / pageHeight;
		commit(
			state.mode === "move"
				? { ...state.from, x: state.from.x + dx, y: state.from.y + dy }
				: { ...state.from, width: state.from.width + dx },
		);
	}

	function end() {
		drag.current = null;
	}

	function finishEditing(save: boolean) {
		if (editing !== null && save && editing.trim()) onNameChange(editing.trim());
		setEditing(null);
	}

	function key(event: KeyboardEvent<HTMLElement>) {
		if (editing !== null) return;
		if (event.key === "Enter") {
			event.preventDefault();
			setEditing(name);
			return;
		}
		const step = event.shiftKey ? 0.05 : 0.01;
		const moves: Record<string, Partial<StampPlacement>> = {
			ArrowLeft: { x: placement.x - step },
			ArrowRight: { x: placement.x + step },
			ArrowUp: { y: placement.y - step },
			ArrowDown: { y: placement.y + step },
			"+": { width: placement.width + step },
			"=": { width: placement.width + step },
			"-": { width: placement.width - step },
		};
		const change = moves[event.key];
		if (!change) return;
		event.preventDefault();
		commit({ ...placement, ...change });
	}

	return (
		<div
			role="button"
			tabIndex={0}
			aria-label="Stamp. Drag to move, or use the arrow keys. Plus and minus resize it. Enter changes the name."
			onPointerDown={(event) => begin(event, "move")}
			onPointerMove={move}
			onPointerUp={end}
			onPointerCancel={end}
			onKeyDown={key}
			// On the stamp rather than on the name: the drag captures the pointer,
			// so the double click is delivered here whichever line it landed on.
			onDoubleClick={() => setEditing(name)}
			title="Double-click to change the name"
			data-stamp
			style={{
				left: placement.x * pageWidth,
				top: placement.y * pageHeight,
				width: metrics.width,
				height: metrics.height,
				padding: metrics.padding,
			}}
			className="absolute cursor-move touch-none select-none text-[var(--canvas-ink)] outline-2 outline-dashed outline-[var(--accent)] focus-visible:outline-solid focus-visible:outline-[var(--focus)]"
		>
			{image ? (
				<img
					src={image.url}
					alt=""
					draggable={false}
					style={{ height: metrics.imageHeight, marginBottom: metrics.gap }}
					className="block max-w-full object-contain object-left"
				/>
			) : null}
			<p
				style={{ height: metrics.nameSize * 1.2, marginBottom: metrics.gap, lineHeight: 1.2 }}
				className="whitespace-nowrap font-[var(--weight-semibold)]"
			>
				{editing === null ? (
					<FitText text={name || "Name"} size={metrics.nameSize} available={inner} />
				) : null}
			</p>
			<p
				style={{ height: metrics.dateSize * 1.2, lineHeight: 1.2 }}
				className="tabular whitespace-nowrap text-[var(--canvas-ink-muted)]"
			>
				<FitText text={dateText} size={metrics.dateSize} available={inner} />
			</p>
			{editing !== null ? (
				<input
					autoFocus
					aria-label="Name on the stamp"
					value={editing}
					onChange={(event) => setEditing(event.target.value)}
					onPointerDown={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === "Enter") finishEditing(true);
						if (event.key === "Escape") finishEditing(false);
					}}
					onBlur={() => finishEditing(true)}
					style={{ top: metrics.padding + (image ? metrics.imageHeight + metrics.gap : 0) - 4 }}
					className="absolute left-0 z-10 w-[max(100%,220px)] rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-base)] text-[var(--ink)] shadow-[var(--shadow-popover)]"
				/>
			) : null}
			<span
				onPointerDown={(event) => begin(event, "resize")}
				onPointerMove={move}
				onPointerUp={end}
				onPointerCancel={end}
				aria-hidden
				className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-[var(--radius-sm)] border border-[var(--accent-ink)] bg-[var(--accent)]"
			/>
		</div>
	);
}
