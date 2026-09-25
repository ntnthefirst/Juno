import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../../components/Icon";
import {
	HUE_SPECTRUM,
	hexDigits,
	hsvToRgb,
	opacityBackground,
	opacityPercent,
	parseHex,
	rgbToHsv,
	squareBackground,
	toHex,
	withDigits,
	withOpacity,
} from "./color";

/**
 * The swatch that opened a picker, and where it was when it was pressed. A
 * press on the swatch itself is left to the swatch, which closes the picker,
 * rather than being taken as a press outside that closes it and a press on
 * the swatch that opens it again.
 */
export type Anchor = { left: number; right: number; top: number; element: HTMLElement };

type PickerPopoverProps = {
	anchor: Anchor;
	title: string;
	onClose: () => void;
	children: ReactNode;
};

const CARD_WIDTH = 248;
/** Room kept below the card, so a tall one opened near the foot of the window still fits. */
const CARD_ROOM = 440;

/**
 * A card that floats beside the panel, the way Figma's colour picker does:
 * to the left of the swatch that opened it, or to its right when there is no
 * room. It is not a dialog. Nothing behind it is blocked, a press anywhere
 * else closes it, and so does Escape, which it takes before the editor does
 * so the first Escape closes the picker and not the selection.
 */
export function PickerPopover({ anchor, title, onClose, children }: PickerPopoverProps) {
	const card = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const outside = (event: globalThis.PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && (card.current?.contains(target) || anchor.element.contains(target))) return;
			onClose();
		};
		const escape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			event.preventDefault();
			onClose();
		};
		document.addEventListener("pointerdown", outside, true);
		window.addEventListener("keydown", escape, true);
		return () => {
			document.removeEventListener("pointerdown", outside, true);
			window.removeEventListener("keydown", escape, true);
		};
	}, [anchor.element, onClose]);

	const leftOf = anchor.left - CARD_WIDTH - 12;
	const left = leftOf >= 8 ? leftOf : Math.min(anchor.right + 12, window.innerWidth - CARD_WIDTH - 8);
	const top = Math.max(8, Math.min(anchor.top - 40, window.innerHeight - CARD_ROOM));

	return createPortal(
		<div
			ref={card}
			role="dialog"
			aria-modal="false"
			aria-label={title}
			style={{ left, top, width: CARD_WIDTH }}
			className="fixed z-50 flex max-h-[calc(100vh-16px)] flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-modal)]"
		>
			<div className="flex h-[36px] flex-none items-center border-b border-[var(--line)] pr-1 pl-3">
				<span className="flex-1 truncate text-[length:var(--text-sm)] font-[var(--weight-semibold)]">{title}</span>
				<button
					type="button"
					aria-label="Close"
					title="Close"
					onClick={onClose}
					className="flex h-[28px] w-[28px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
				>
					<Icon name="close" size={14} />
				</button>
			</div>
			<div className="flex flex-col gap-2 p-3">{children}</div>
		</div>,
		document.body,
	);
}

type ColorAreaProps = {
	value: string;
	onChange: (value: string) => void;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Where a pointer is across and down an element, each from 0 to 1. */
function fraction(event: PointerEvent<HTMLElement>): { x: number; y: number } {
	const rect = event.currentTarget.getBoundingClientRect();
	return {
		x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
		y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
	};
}

/** A step for an arrow key: one percent, ten with Shift. */
function step(event: KeyboardEvent): number {
	return event.shiftKey ? 0.1 : 0.01;
}

const THUMB =
	"pointer-events-none absolute h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] shadow-[var(--shadow-popover)]";

const CHECKERS = "repeating-conic-gradient(var(--line) 0 25%, var(--surface) 0 50%) 0 0 / 8px 8px";

/**
 * Figma's picker: saturation and brightness in the square, hue and opacity on
 * the two sliders, and the hex and the percentage typed. Every part answers
 * to the arrow keys as well as the pointer.
 *
 * The hue is kept apart from the colour while the colour is grey, because a
 * grey says nothing about its hue, and dragging the brightness down and back
 * up should not throw away the hue somebody chose.
 */
export function ColorArea({ value, onChange }: ColorAreaProps) {
	const parsed = parseHex(value) ?? { r: 255, g: 255, b: 255, a: 1 };
	const hsv = rgbToHsv(parsed);
	const [keptHue, setKeptHue] = useState(hsv.h);
	const hue = hsv.s > 0 && hsv.v > 0 ? hsv.h : keptHue;
	const [typed, setTyped] = useState<{ over: string; text: string } | null>(null);
	const hex = typed && typed.over === value ? typed.text : hexDigits(value);
	const [typedPercent, setTypedPercent] = useState<{ over: string; text: string } | null>(null);
	const percent = typedPercent && typedPercent.over === value ? typedPercent.text : String(opacityPercent(value));

	const setHsv = (next: { s?: number; v?: number; h?: number }) => {
		const h = next.h ?? hue;
		if (next.h !== undefined) setKeptHue(next.h);
		onChange(toHex(hsvToRgb({ h, s: next.s ?? hsv.s, v: next.v ?? hsv.v, a: parsed.a })));
	};

	const drag = (move: (event: PointerEvent<HTMLDivElement>) => void) => ({
		onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
			event.currentTarget.setPointerCapture(event.pointerId);
			move(event);
		},
		onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
			if (event.buttons & 1) move(event);
		},
	});

	const commitHex = () => {
		const next = withDigits(value, hex);
		setTyped(null);
		if (next) onChange(next);
	};

	const commitPercent = () => {
		const next = Number.parseFloat(percent);
		setTypedPercent(null);
		if (Number.isFinite(next)) onChange(withOpacity(value, next));
	};

	return (
		<div className="flex flex-col gap-2.5">
			<div
				role="slider"
				tabIndex={0}
				aria-label="Saturation and brightness"
				aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
				aria-valuenow={Math.round(hsv.v * 100)}
				style={{ background: squareBackground(hue) }}
				className="relative h-[160px] cursor-crosshair touch-none rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				{...drag((event) => {
					const { x, y } = fraction(event);
					setHsv({ s: x, v: 1 - y });
				})}
				onKeyDown={(event) => {
					const by = step(event);
					if (event.key === "ArrowLeft") setHsv({ s: clamp(hsv.s - by, 0, 1) });
					else if (event.key === "ArrowRight") setHsv({ s: clamp(hsv.s + by, 0, 1) });
					else if (event.key === "ArrowUp") setHsv({ v: clamp(hsv.v + by, 0, 1) });
					else if (event.key === "ArrowDown") setHsv({ v: clamp(hsv.v - by, 0, 1) });
					else return;
					event.preventDefault();
				}}
			>
				<span
					className={THUMB}
					style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toHex({ ...parsed, a: 1 }) }}
				/>
			</div>

			<div
				role="slider"
				tabIndex={0}
				aria-label="Hue"
				aria-valuemin={0}
				aria-valuemax={360}
				aria-valuenow={Math.round(hue)}
				style={{ background: HUE_SPECTRUM }}
				className="relative h-[12px] cursor-pointer touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				{...drag((event) => setHsv({ h: fraction(event).x * 360 }))}
				onKeyDown={(event) => {
					const by = step(event) * 360;
					if (event.key === "ArrowLeft" || event.key === "ArrowDown") setHsv({ h: clamp(hue - by, 0, 360) });
					else if (event.key === "ArrowRight" || event.key === "ArrowUp") setHsv({ h: clamp(hue + by, 0, 360) });
					else return;
					event.preventDefault();
				}}
			>
				<span className={THUMB} style={{ left: `${(hue / 360) * 100}%`, top: "50%" }} />
			</div>

			<div
				role="slider"
				tabIndex={0}
				aria-label="Opacity"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={opacityPercent(value)}
				style={{ background: `${opacityBackground(value)}, ${CHECKERS}` }}
				className="relative h-[12px] cursor-pointer touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				{...drag((event) => onChange(toHex({ ...parsed, a: fraction(event).x })))}
				onKeyDown={(event) => {
					const by = step(event);
					if (event.key === "ArrowLeft" || event.key === "ArrowDown") onChange(toHex({ ...parsed, a: clamp(parsed.a - by, 0, 1) }));
					else if (event.key === "ArrowRight" || event.key === "ArrowUp") onChange(toHex({ ...parsed, a: clamp(parsed.a + by, 0, 1) }));
					else return;
					event.preventDefault();
				}}
			>
				<span className={THUMB} style={{ left: `${parsed.a * 100}%`, top: "50%" }} />
			</div>

			<div className="flex h-[28px] items-center rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
				<span className="pl-2 text-[length:var(--text-micro)] text-[var(--ink-muted)]">Hex</span>
				<input
					value={hex}
					spellCheck={false}
					aria-label="Hex value"
					onChange={(event) => setTyped({ over: value, text: event.target.value })}
					onBlur={commitHex}
					onKeyDown={(event) => {
						if (event.key === "Enter") commitHex();
					}}
					className="tabular min-w-0 flex-1 bg-transparent px-2 font-mono text-[length:var(--text-micro)] text-[var(--ink)] uppercase focus:outline-none"
				/>
				<span aria-hidden className="h-[16px] w-px bg-[var(--line)]" />
				<input
					value={percent}
					inputMode="numeric"
					aria-label="Opacity in percent"
					onChange={(event) => setTypedPercent({ over: value, text: event.target.value })}
					onBlur={commitPercent}
					onKeyDown={(event) => {
						if (event.key === "Enter") commitPercent();
					}}
					className="tabular w-[36px] bg-transparent pl-2 text-right text-[length:var(--text-sm)] text-[var(--ink)] focus:outline-none"
				/>
				<span className="pr-2 pl-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">%</span>
			</div>
		</div>
	);
}
