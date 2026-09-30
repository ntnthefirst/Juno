import { useState, type ReactNode } from "react";
import { hexDigits, opacityPercent, withDigits, withOpacity } from "./color";
import { ColorArea, PickerPopover, type Anchor } from "./ColorPicker";

type ColorRowProps = {
	/** What the colour is, for a screen reader and as the picker's title. */
	label: string;
	/** Null is "not set": the row shows `fallback`, faintly, and setting anything sets it. */
	value: string | null;
	fallback?: string;
	onChange: (value: string) => void;
	/**
	 * A fill that is more than one colour: it draws its own swatch, names
	 * itself where the hex would be, and has an opacity of its own.
	 */
	paint?: { swatch: string; name: string; opacity: number; onOpacity: (percent: number) => void };
	/** What the picker holds, when it is more than the one colour. */
	picker?: ReactNode;
};

/** The squares behind a swatch, so a see-through colour looks see-through. */
const CHECKERS = "repeating-conic-gradient(var(--line) 0 25%, var(--surface) 0 50%) 0 0 / 6px 6px";

/**
 * A colour the way Figma shows one: the swatch, the six digits, and the
 * opacity as a percentage. The swatch opens the picker beside the panel; the
 * digits and the percentage are typed.
 */
export function ColorRow({ label, value, fallback = "#ffffff", onChange, paint, picker }: ColorRowProps) {
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const current = value ?? fallback;
	const [typedHex, setTypedHex] = useState<{ over: string | null; text: string } | null>(null);
	const hex = typedHex && typedHex.over === value ? typedHex.text : value === null ? "" : hexDigits(value);
	const percentValue = paint ? paint.opacity : opacityPercent(current);
	const [typedPercent, setTypedPercent] = useState<{ over: number; text: string } | null>(null);
	const percent = typedPercent && typedPercent.over === percentValue ? typedPercent.text : String(percentValue);

	const commitHex = () => {
		setTypedHex(null);
		if (!hex.trim()) return;
		const next = withDigits(current, hex);
		if (next && next !== value) onChange(next);
	};

	const commitPercent = () => {
		setTypedPercent(null);
		const next = Number.parseFloat(percent);
		if (!Number.isFinite(next) || next === percentValue) return;
		if (paint) paint.onOpacity(Math.min(Math.max(next, 0), 100));
		else onChange(withOpacity(current, next));
	};

	return (
		<>
			<div className="flex h-[28px] min-w-0 items-center rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
				<button
					type="button"
					aria-label={`Pick ${label.toLowerCase()}`}
					title={`Pick ${label.toLowerCase()}`}
					aria-expanded={anchor !== null}
					onClick={(event) => {
						const rect = event.currentTarget.getBoundingClientRect();
						setAnchor((open) => (open ? null : { left: rect.left, right: rect.right, top: rect.top, element: event.currentTarget }));
					}}
					style={{ background: `linear-gradient(${paint?.swatch ?? current}, ${paint?.swatch ?? current}), ${CHECKERS}` }}
					className={`ml-1 h-[18px] w-[18px] flex-none rounded-[3px] border border-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
						value === null && !paint ? "opacity-50" : ""
					}`}
				/>
				{paint ? (
					<span className="min-w-0 flex-1 truncate px-2 text-[length:var(--text-sm)] text-[var(--ink)]">{paint.name}</span>
				) : (
					<input
						value={hex}
						spellCheck={false}
						placeholder={hexDigits(fallback)}
						aria-label={`${label}, hex value`}
						onChange={(event) => setTypedHex({ over: value, text: event.target.value })}
						onBlur={commitHex}
						onKeyDown={(event) => {
							if (event.key === "Enter") commitHex();
						}}
						className="tabular min-w-0 flex-1 bg-transparent px-2 font-mono text-[length:var(--text-micro)] text-[var(--ink)] uppercase placeholder:text-[var(--ink-muted)] focus:outline-none"
					/>
				)}
				<span aria-hidden className="h-[16px] w-px flex-none bg-[var(--line)]" />
				<input
					value={percent}
					inputMode="numeric"
					aria-label={`${label}, opacity in percent`}
					onChange={(event) => setTypedPercent({ over: percentValue, text: event.target.value })}
					onBlur={commitPercent}
					onKeyDown={(event) => {
						if (event.key === "Enter") commitPercent();
					}}
					className={`tabular w-[34px] flex-none bg-transparent pl-1.5 text-right text-[length:var(--text-sm)] focus:outline-none ${
						value === null && !paint ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"
					}`}
				/>
				<span className="flex-none pr-2 pl-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">%</span>
			</div>
			{anchor ? (
				<PickerPopover anchor={anchor} title={label} onClose={() => setAnchor(null)}>
					{picker ?? <ColorArea value={current} onChange={onChange} />}
				</PickerPopover>
			) : null}
		</>
	);
}
