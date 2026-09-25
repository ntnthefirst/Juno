/**
 * The controls the design panel is built from.
 *
 * A panel on the edge of a canvas is not a form: it is twenty controls in the
 * width of one, read while looking at something else. So they are Figma's
 * size, 28 pixels, labelled by a glyph rather than a word, with the word in
 * the tooltip. That is under the 32 pixel target the styling rules set for a
 * dense control, by the owner's choice for this editor, and styling.md says so
 * where the rule is.
 */
import { useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../../../components/Icon";

const CONTROL =
	"h-[28px] w-full min-w-0 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-2 text-[length:var(--text-sm)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none";

type PanelSectionProps = {
	title: string;
	/** A control in the header row, usually what adds one of whatever this holds. */
	action?: ReactNode;
	children?: ReactNode;
};

/** One group in the panel, with the hairline that separates it from the next. */
export function PanelSection({ title, action, children }: PanelSectionProps) {
	return (
		<section className="border-b border-[var(--line)] px-3 py-2">
			<div className="flex h-[28px] items-center gap-2">
				<h3 className="flex-1 text-[length:var(--text-sm)] font-[var(--weight-semibold)] text-[var(--ink)]">
					{title}
				</h3>
				{action}
			</div>
			{children ? <div className="mt-1 flex flex-col gap-1.5">{children}</div> : null}
		</section>
	);
}

type PanelButtonProps = {
	label: string;
	icon: IconName;
	onClick: () => void;
	disabled?: boolean;
	tone?: "quiet" | "danger";
	/** For a toggle: whether it is on. Left out, the button is not a toggle. */
	active?: boolean;
};

/** The small square button in a section header or beside a row. */
export function PanelButton({ label, icon, onClick, disabled = false, tone = "quiet", active }: PanelButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`flex h-[28px] w-[28px] flex-none items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40 ${
				tone === "danger"
					? "text-[var(--ink-muted)] hover:bg-[var(--risk-soft)] hover:text-[var(--risk)]"
					: active
						? "bg-[var(--accent-soft)] text-[var(--accent)]"
						: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
			}`}
		>
			<Icon name={icon} size={14} />
		</button>
	);
}

type PanelPairProps = { children: ReactNode };

/** Two controls side by side, which is how most of this panel reads. */
export function PanelPair({ children }: PanelPairProps) {
	return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

type NumberInputProps = {
	/** Two characters at most: it sits inside the control, not above it. */
	prefix?: string;
	icon?: IconName;
	label: string;
	/** Null shows the field empty, with `unset` written in it. */
	value: number | null;
	onChange: (value: number) => void;
	/** What an empty field means, and what committing it empty does. */
	unset?: { label: string; onClear: () => void };
	min?: number;
	max?: number;
	step?: number;
	suffix?: string;
	disabled?: boolean;
};

/**
 * A number with its name inside the control.
 *
 * It holds what was typed while it is being typed, so clearing the box to type
 * a new number does not snap to a zero under the cursor, and it commits on
 * blur and on Enter.
 */
export function NumberInput({
	prefix,
	icon,
	label,
	value,
	onChange,
	min,
	max,
	step = 1,
	suffix,
	disabled = false,
	unset,
}: NumberInputProps) {
	const id = useId();
	const [typed, setTyped] = useState<string | null>(null);

	const commit = (raw: string) => {
		setTyped(null);
		if (!raw.trim() && unset) {
			unset.onClear();
			return;
		}
		const parsed = Number.parseFloat(raw);
		if (!Number.isFinite(parsed)) return;
		const floored = min === undefined ? parsed : Math.max(min, parsed);
		onChange(max === undefined ? floored : Math.min(max, floored));
	};

	return (
		<div className="flex h-[28px] items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-2 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
			<label
				htmlFor={id}
				title={label}
				className="flex flex-none items-center text-[length:var(--text-micro)] text-[var(--ink-muted)]"
			>
				{icon ? <Icon name={icon} size={12} /> : prefix}
				<span className="sr-only">{label}</span>
			</label>
			<input
				id={id}
				type="number"
				inputMode="decimal"
				step={step}
				min={min}
				max={max}
				disabled={disabled}
				value={typed ?? (value === null ? "" : String(value))}
				placeholder={unset?.label}
				onChange={(event) => setTyped(event.target.value)}
				onBlur={(event) => commit(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit(event.currentTarget.value);
				}}
				className="tabular min-w-0 flex-1 bg-transparent py-0 text-[length:var(--text-sm)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			{suffix ? (
				<span className="flex-none text-[length:var(--text-micro)] text-[var(--ink-faint)]">{suffix}</span>
			) : null}
		</div>
	);
}

type TextInputProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: "text" | "url";
	multiline?: boolean;
	rows?: number;
	mono?: boolean;
	/** What Enter does in a one-line field, when it does something. */
	onEnter?: () => void;
};

/** A string, labelled for a screen reader and by its placeholder on screen. */
export function TextInput({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
	multiline = false,
	rows = 3,
	mono = false,
	onEnter,
}: TextInputProps) {
	const id = useId();
	const classes = `${CONTROL}${mono ? " font-mono text-[length:var(--text-micro)]" : ""}`;
	return (
		<div>
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			{multiline ? (
				<textarea
					id={id}
					rows={rows}
					value={value}
					placeholder={placeholder}
					onChange={(event) => onChange(event.target.value)}
					className={`${classes} h-auto resize-y py-1.5 leading-[var(--leading-normal)]`}
				/>
			) : (
				<input
					id={id}
					type={type}
					value={value}
					placeholder={placeholder}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && onEnter) {
							event.preventDefault();
							onEnter();
						}
					}}
					className={classes}
				/>
			)}
		</div>
	);
}

type PanelSelectProps = {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
	/** The empty option's wording. Left out means there is no empty option. */
	placeholder?: string;
};

/** One of a list too long to lay out as a row. */
export function PanelSelect({ label, value, options, onChange, placeholder }: PanelSelectProps) {
	const id = useId();
	return (
		<div>
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			<select
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={CONTROL}
			>
				{placeholder !== undefined ? <option value="">{placeholder}</option> : null}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

type ColorInputProps = {
	label: string;
	value: string | null;
	onChange: (value: string | null) => void;
	/** Offered when the swatch is clicked while nothing is set. */
	fallback?: string;
	/** A colour that is part of what the thing is, so it cannot be cleared. */
	required?: boolean;
};

/**
 * A colour: the swatch, the hex beside it, and a way back to nothing.
 *
 * The hex is typed as well as picked, because a brand colour arrives as six
 * characters in an email and not as a point on a wheel.
 */
export function ColorInput({ label, value, onChange, fallback = "#ffffff", required = false }: ColorInputProps) {
	const id = useId();
	// What is being typed, and the value it was typed over. Holding both means
	// a colour changed from somewhere else (the swatch, a reset) shows straight
	// away, while a half-typed hex survives every other re-render, and neither
	// needs an effect to notice.
	const [typed, setTyped] = useState<{ over: string | null; text: string } | null>(null);
	const shown = typed && typed.over === value ? typed.text : (value ?? "");

	return (
		<div className="flex h-[28px] items-center gap-2 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pr-0.5 pl-1 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			<input
				id={id}
				type="color"
				value={value ?? fallback}
				onChange={(event) => onChange(event.target.value)}
				title={label}
				className="h-[20px] w-[20px] flex-none cursor-pointer rounded-[var(--radius-sm)] border border-[var(--line)] bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[2px] [&::-webkit-color-swatch]:border-0"
			/>
			<input
				type="text"
				value={shown}
				spellCheck={false}
				placeholder="None"
				aria-label={`${label}, hex value`}
				onChange={(event) => setTyped({ over: value, text: event.target.value })}
				onBlur={() => {
					const next = shown.trim();
					setTyped(null);
					if (!next) {
						if (!required) onChange(null);
						return;
					}
					const hex = next.startsWith("#") ? next : `#${next}`;
					if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) onChange(hex);
				}}
				className="tabular min-w-0 flex-1 bg-transparent font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)] uppercase placeholder:normal-case focus:outline-none"
			/>
			{value && !required ? <PanelButton label={`Clear ${label}`} icon="close" onClick={() => onChange(null)} /> : null}
		</div>
	);
}

export type SegmentedOption<T extends string> = {
	value: T;
	/** Shown when there is no icon. Two or three characters. */
	label: string;
	icon?: IconName;
	/** The tooltip, and what a screen reader reads. */
	title?: string;
	/** For a drawing that means the same thing turned: distribution down a column. */
	iconClass?: string;
};

type SegmentedProps<T extends string> = {
	label: string;
	/** Null, or a value no option has, shows nothing pressed. */
	value: T | null;
	options: SegmentedOption<T>[];
	onChange: (value: T) => void;
	/** When given, pressing the active option again lets go of it. */
	onClear?: () => void;
	/** Shown and not pressable, the way Figma greys out an alignment that does not apply. */
	disabled?: boolean;
};

/** One of a handful of choices, laid out as a row rather than a dropdown,
 * because a row shows what the choices are without being opened. */
export function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
	onClear,
	disabled = false,
}: SegmentedProps<T>) {
	return (
		<div
			role="group"
			aria-label={label}
			aria-disabled={disabled || undefined}
			className={`flex h-[28px] items-center gap-px rounded-[var(--radius-sm)] bg-[var(--sunken)] p-px ${disabled ? "opacity-40" : ""}`}
		>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						disabled={disabled}
						title={option.title ?? option.label}
						onClick={() => (active && onClear ? onClear() : onChange(option.value))}
						className={`flex h-[26px] min-w-[26px] flex-1 items-center justify-center rounded-[3px] px-1 text-[length:var(--text-micro)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
							active
								? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-popover)]"
								: "text-[var(--ink-muted)] hover:text-[var(--ink)]"
						}`}
					>
						{option.icon ? <Icon name={option.icon} size={14} className={option.iconClass} /> : option.label}
						{option.icon ? <span className="sr-only">{option.title ?? option.label}</span> : null}
					</button>
				);
			})}
		</div>
	);
}

/** Figma's three ways a side can be sized. Matches Sizing in sizing.ts. */
type DimensionMode = "fixed" | "hug" | "fill";

const MODE_LABELS: Record<DimensionMode, string> = { fixed: "Fixed", hug: "Hug", fill: "Fill" };

type DimensionInputProps = {
	/** W or H, inside the field. */
	prefix: string;
	label: string;
	/** How big it is drawn, or its own number when it is fixed. Null when it is not drawn. */
	value: number | null;
	/** Whether a number can be typed. Typing one makes the side fixed. */
	editable: boolean;
	onValue: (value: number) => void;
	mode: DimensionMode;
	/** The modes this side can have. One or none shows no choice. */
	modes: DimensionMode[];
	onMode: (mode: DimensionMode) => void;
	/** Words for the choices, where Figma's would mislead: a frame fills the mail client, not a container. */
	modeLabels?: Partial<Record<DimensionMode, string>>;
	min?: number;
	max?: number;
};

/**
 * Figma's W and H: the size, and beside it inside the same field whether that
 * side is fixed, hugs what is in it, or fills what it is in. The number is
 * always how big it is drawn, so a side that fills still says how wide it came
 * out, and typing a number fixes it at that.
 */
export function DimensionInput({
	prefix,
	label,
	value,
	editable,
	onValue,
	mode,
	modes,
	onMode,
	modeLabels = {},
	min = 1,
	max = 2000,
}: DimensionInputProps) {
	const id = useId();
	const [typed, setTyped] = useState<{ over: number | null; text: string } | null>(null);
	const shown = typed && typed.over === value ? typed.text : value === null ? "" : String(value);

	const commit = () => {
		const parsed = Number.parseFloat(shown);
		setTyped(null);
		if (!Number.isFinite(parsed) || parsed === value) return;
		onValue(Math.min(Math.max(parsed, min), max));
	};

	return (
		<div className="flex h-[28px] min-w-0 items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pl-2 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
			<label htmlFor={id} title={label} className="flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
				{prefix}
				<span className="sr-only">{label}</span>
			</label>
			<input
				id={id}
				inputMode="decimal"
				readOnly={!editable}
				value={shown}
				placeholder="Auto"
				onChange={(event) => setTyped({ over: value, text: event.target.value })}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
				className={`tabular min-w-0 flex-1 bg-transparent text-[length:var(--text-sm)] placeholder:text-[var(--ink-muted)] focus:outline-none ${
					editable ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
				}`}
			/>
			{modes.length > 1 ? (
				<select
					aria-label={`${label} resizing`}
					value={mode}
					onChange={(event) => onMode(event.target.value as DimensionMode)}
					className="h-[26px] max-w-[52px] flex-none cursor-pointer rounded-[var(--radius-sm)] bg-transparent pr-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)] hover:text-[var(--ink)] focus:outline-none focus-visible:outline-2 focus-visible:outline-focus"
				>
					{modes.map((option) => (
						<option key={option} value={option}>
							{modeLabels[option] ?? MODE_LABELS[option]}
						</option>
					))}
				</select>
			) : (
				<span className="pr-2 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
					{modeLabels[mode] ?? MODE_LABELS[mode]}
				</span>
			)}
		</div>
	);
}

type CheckboxProps = {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
};

export function PanelCheckbox({ label, checked, onChange }: CheckboxProps) {
	return (
		<label className="flex h-[28px] items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="h-4 w-4 accent-[var(--accent)]"
			/>
			{label}
		</label>
	);
}

type PanelNoteProps = { children: ReactNode; tone?: "muted" | "warn" };

/** The line under a control that says what it will do to a message. */
export function PanelNote({ children, tone = "muted" }: PanelNoteProps) {
	return (
		<p
			className={`text-[length:var(--text-micro)] leading-[var(--leading-normal)] ${
				tone === "warn" ? "border-l-2 border-[var(--warn)] pl-2 text-[var(--warn)]" : "text-[var(--ink-muted)]"
			}`}
		>
			{children}
		</p>
	);
}
