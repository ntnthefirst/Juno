import type {
	MailAlign,
	MailBlock,
	MailBoxStyle,
	MailEffect,
	MailFill,
	MailFontFallback,
	MailLayout,
	MailSection,
	MailTextStyle,
	TemplateInput,
} from "@shared/types";
import { Button } from "../../../../components/Button";
import { isMac } from "../../../../lib/platform";
import { effectLabel } from "./box-style";
import {
	BLOCK_KIND_LABELS,
	colorsIn,
	newBlur,
	newShadow,
	replaceColor,
	solidFill,
	updateBlock,
} from "./canvas-actions";
import type { Measured, Selection } from "./CanvasView";
import { FontsSection } from "./FontsSection";
import {
	ColorInput,
	NumberInput,
	PanelButton,
	PanelCheckbox,
	PanelNote,
	PanelPair,
	PanelSection,
	PanelSelect,
	Segmented,
	TextInput,
	type SegmentedOption,
} from "./panel-controls";
import {
	acrossOf,
	alignAcross,
	fixedHeight,
	fixedWidth,
	heightModes,
	heightSizing,
	setHeight,
	setWidth,
	sizeHeight,
	sizeWidth,
	widthModes,
	widthSizing,
	type Across,
	type Sizing,
} from "./sizing";
import { TypographySection } from "./TypographySection";
import type { CanvasFonts } from "./use-canvas-fonts";

type DesignPanelProps = {
	layout: MailLayout;
	inputs: TemplateInput[];
	selection: Selection;
	/** What the content already comes to. The height control will not go under it. */
	contentHeight: number;
	/** How big what is selected is drawn, so W and H read true while it hugs or fills. */
	measured: Measured | null;
	/** The linked fonts' state on the canvas, for the Fonts section. */
	fonts: CanvasFonts;
	onLayout: (patch: Partial<Omit<MailLayout, "sections" | "version">>) => void;
	/** A change that reaches across the whole canvas at once, like a selection colour. */
	onReplace: (layout: MailLayout) => void;
	onSection: (sectionId: string, patch: Partial<Omit<MailSection, "id" | "blocks">>) => void;
	onBlock: (sectionId: string, blockId: string, patch: Partial<MailBlock>) => void;
	onRemoveSection: (sectionId: string) => void;
	onRemoveBlock: (sectionId: string, blockId: string) => void;
	/** Turns a block into the HTML and CSS it compiles to. */
	onConvert: (sectionId: string, blockId: string) => void;
};

type BoxPatch = (patch: Partial<MailBoxStyle>) => void;

/** Which way across a section runs: across for a column, down for a row or a grid cell. */
type Axis = "h" | "v";

/**
 * What each kind of block actually compiles, so the panel offers exactly that
 * and not a control that changes nothing in the message. A divider is a rule,
 * so it has no fill or stroke of its own; a button's fill is part of the
 * button; a spacer is a height and nothing else. A code block is not here: it
 * is its own HTML and CSS and has no controls at all. Which way a block can be
 * resized is in sizing.ts, because it depends on the section as well.
 */
type Capabilities = {
	fill: boolean;
	stroke: boolean;
	effects: boolean;
	radius: "box" | "button" | null;
	opacity: boolean;
	padding: boolean;
	clip: boolean;
};

const BOXED: Capabilities = {
	fill: true,
	stroke: true,
	effects: true,
	radius: "box",
	opacity: true,
	padding: true,
	clip: true,
};

const CAN: Record<Exclude<MailBlock["kind"], "html">, Capabilities> = {
	text: BOXED,
	heading: BOXED,
	field: BOXED,
	button: { ...BOXED, fill: false, radius: "button", clip: false },
	image: { ...BOXED, clip: false },
	divider: {
		fill: false,
		stroke: false,
		effects: false,
		radius: null,
		opacity: true,
		padding: true,
		clip: false,
	},
	spacer: {
		fill: false,
		stroke: false,
		effects: false,
		radius: null,
		opacity: false,
		padding: false,
		clip: false,
	},
};

/** The cross axis of a section, which is the one a block's own alignment moves it along. */
function crossAxis(section: MailSection): Axis {
	return section.layout.kind === "flex" && section.layout.direction === "column" ? "h" : "v";
}

const ALT = isMac ? "Option" : "Alt";

type AcrossOption = SegmentedOption<Across> & { keys: string };

/** Start, middle and end across a section, with Figma's keys for each. */
function acrossChoices(axis: Axis): AcrossOption[] {
	return axis === "h"
		? [
				{ value: "start", label: "Left", icon: "self-h-start", title: "Align left", keys: `${ALT}+A` },
				{ value: "center", label: "Centre", icon: "self-h-center", title: "Align centre", keys: `${ALT}+H` },
				{ value: "end", label: "Right", icon: "self-h-end", title: "Align right", keys: `${ALT}+D` },
			]
		: [
				{ value: "start", label: "Top", icon: "self-v-start", title: "Align top", keys: `${ALT}+W` },
				{ value: "center", label: "Middle", icon: "self-v-center", title: "Align middle", keys: `${ALT}+V` },
				{ value: "end", label: "Bottom", icon: "self-v-end", title: "Align bottom", keys: `${ALT}+S` },
			];
}

/** Where a block sits across its section, the keys in the tooltips. */
function acrossOptions(axis: Axis): SegmentedOption<Across>[] {
	return acrossChoices(axis).map(({ keys, ...option }) => ({ ...option, title: `${option.title} (${keys})` }));
}

/** The same, and stretching, for where a section puts everything in it. */
function alignOptions(axis: Axis): SegmentedOption<MailAlign>[] {
	return [
		...acrossChoices(axis).map(
			(option): SegmentedOption<MailAlign> => ({
				value: option.value,
				label: option.label,
				icon: option.icon,
				title: option.title,
			}),
		),
		axis === "h"
			? { value: "stretch", label: "Stretch", icon: "self-h-stretch", title: "Stretch across" }
			: { value: "stretch", label: "Stretch", icon: "self-v-stretch", title: "Stretch down" },
	];
}

/** Figma's three resizing marks, turned upright for a height. */
function sizingOptions(axis: "width" | "height", modes: Sizing[]): SegmentedOption<Sizing>[] {
	const turned = axis === "height" ? "rotate-90" : undefined;
	const all: Record<Sizing, SegmentedOption<Sizing>> = {
		fixed: {
			value: "fixed",
			label: "Fixed",
			icon: "size-fixed",
			title: axis === "width" ? "Fixed width" : "Fixed height",
			iconClass: turned,
		},
		hug: { value: "hug", label: "Hug", icon: "size-hug", title: "Hug contents", iconClass: turned },
		fill: { value: "fill", label: "Fill", icon: "size-fill", title: "Fill container", iconClass: turned },
	};
	return modes.map((mode) => all[mode]);
}

/* ------------------------------------------------------------------ pieces */

type HeaderProps = {
	label: string;
	deleteLabel: string;
	onDelete: () => void;
	/** The eye, where there is no appearance section to hold it. */
	hidden?: { value: boolean; onChange: (hidden: boolean) => void };
};

/** The top row: what is selected, and deleting it. Reordering is a drag in the layers. */
function Header({ label, deleteLabel, onDelete, hidden }: HeaderProps) {
	return (
		<div className="flex h-[36px] flex-none items-center gap-0.5 border-b border-[var(--line)] pr-1.5 pl-3">
			<span className="flex-1 truncate text-[length:var(--text-sm)] font-[var(--weight-semibold)]">{label}</span>
			{hidden ? (
				<PanelButton
					label={hidden.value ? "Show in the message" : "Hide from the message"}
					icon={hidden.value ? "hidden" : "visible"}
					active={hidden.value}
					onClick={() => hidden.onChange(!hidden.value)}
				/>
			) : null}
			<PanelButton label={deleteLabel} icon="remove" tone="danger" onClick={onDelete} />
		</div>
	);
}

type ReadOnlyValueProps = { prefix: string; label: string; value: string };

/** A dimension that is not a number yet: a width that hugs or fills. */
function ReadOnlyValue({ prefix, label, value }: ReadOnlyValueProps) {
	return (
		<div
			aria-label={`${label}: ${value}`}
			className="flex h-[28px] items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
		>
			<span className="text-[length:var(--text-micro)]">{prefix}</span>
			{value}
		</div>
	);
}

type AlignmentSectionProps = {
	axis: Axis;
	value: Across | null;
	onChange: (value: Across | null) => void;
};

/**
 * Figma's alignment row, which here moves a block across its section rather
 * than to a coordinate. It shows where the block actually sits, including
 * where the section puts it, and nothing while it is stretched, which is a
 * fill in the layout below. Pressing the pressed one goes back to what the
 * section says.
 */
function AlignmentSection({ axis, value, onChange }: AlignmentSectionProps) {
	return (
		<PanelSection title="Alignment">
			<Segmented
				label="Where the block sits across its section"
				value={value}
				options={acrossOptions(axis)}
				onChange={onChange}
				onClear={() => onChange(null)}
			/>
		</PanelSection>
	);
}

type FillSectionProps = { fill: MailFill | null; onFill: (fill: MailFill | null) => void };

function FillSection({ fill, onFill }: FillSectionProps) {
	const first = fill === null ? "#ffffff" : fill.kind === "solid" ? fill.color : fill.from;
	return (
		<PanelSection
			title="Fill"
			action={
				fill ? (
					<PanelButton label="Remove fill" icon="close" onClick={() => onFill(null)} />
				) : (
					<PanelButton label="Add fill" icon="add" onClick={() => onFill(solidFill("#ffffff"))} />
				)
			}
		>
			{fill ? (
				<>
					<div className="flex items-center gap-1.5">
						<div className="w-[62px] flex-none">
							<Segmented
								label="Fill type"
								value={fill.kind}
								options={[
									{ value: "solid", label: "Solid", icon: "fill-solid", title: "Solid" },
									{ value: "gradient", label: "Gradient", icon: "fill-gradient", title: "Linear gradient" },
								]}
								onChange={(kind) =>
									onFill(
										kind === "solid"
											? solidFill(first)
											: { kind: "gradient", angle: 180, from: first, to: "#ffffff" },
									)
								}
							/>
						</div>
						<div className="min-w-0 flex-1">
							{fill.kind === "solid" ? (
								<ColorInput
									label="Fill colour"
									required
									value={fill.color}
									onChange={(next) => onFill(solidFill(next ?? "#ffffff"))}
								/>
							) : (
								<NumberInput
									label="Angle in degrees"
									prefix="deg"
									value={fill.angle}
									min={0}
									max={360}
									onChange={(next) => onFill({ ...fill, angle: next })}
								/>
							)}
						</div>
					</div>
					{fill.kind === "gradient" ? (
						<>
							<PanelPair>
								<ColorInput
									label="Gradient start"
									required
									value={fill.from}
									onChange={(next) => onFill({ ...fill, from: next ?? "#ffffff" })}
								/>
								<ColorInput
									label="Gradient end"
									required
									value={fill.to}
									onChange={(next) => onFill({ ...fill, to: next ?? "#000000" })}
								/>
							</PanelPair>
							<PanelNote>A client that cannot draw a gradient paints the start colour flat.</PanelNote>
						</>
					) : null}
				</>
			) : null}
		</PanelSection>
	);
}

type BoxSectionProps = { box: MailBoxStyle; onBox: BoxPatch };

function StrokeSection({ box, onBox }: BoxSectionProps) {
	return (
		<PanelSection
			title="Stroke"
			action={
				box.borderWidth > 0 ? (
					<PanelButton label="Remove stroke" icon="close" onClick={() => onBox({ borderWidth: 0 })} />
				) : (
					<PanelButton
						label="Add stroke"
						icon="add"
						onClick={() => onBox({ borderWidth: 1, borderColor: box.borderColor ?? "#e3e2ec" })}
					/>
				)
			}
		>
			{box.borderWidth > 0 ? (
				<>
					<ColorInput
						label="Stroke colour"
						value={box.borderColor}
						fallback="#e3e2ec"
						onChange={(next) => onBox({ borderColor: next })}
					/>
					<PanelPair>
						<NumberInput
							label="Stroke width"
							prefix="W"
							value={box.borderWidth}
							min={0}
							max={40}
							onChange={(next) => onBox({ borderWidth: next })}
						/>
						<Segmented
							label="Stroke style"
							value={box.borderStyle}
							options={[
								{ value: "solid", label: "Solid", icon: "stroke-solid", title: "Solid" },
								{ value: "dashed", label: "Dashed", icon: "stroke-dashed", title: "Dashed" },
								{ value: "dotted", label: "Dotted", icon: "stroke-dotted", title: "Dotted" },
							]}
							onChange={(next) => onBox({ borderStyle: next })}
						/>
					</PanelPair>
				</>
			) : null}
		</PanelSection>
	);
}

type EffectRowProps = {
	effect: MailEffect;
	onChange: (effect: MailEffect) => void;
	onRemove: () => void;
};

function EffectRow({ effect, onChange, onRemove }: EffectRowProps) {
	return (
		<div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] p-1.5">
			<div className="flex items-center gap-1">
				<div className="min-w-0 flex-1">
					<Segmented
						label="Effect"
						value={effect.kind === "blur" ? "blur" : effect.inset ? "inner" : "drop"}
						options={[
							{ value: "drop", label: "Drop shadow", icon: "effect-drop", title: "Drop shadow" },
							{ value: "inner", label: "Inner shadow", icon: "effect-inner", title: "Inner shadow" },
							{ value: "blur", label: "Layer blur", icon: "effect-blur", title: "Layer blur" },
						]}
						onChange={(next) => onChange(next === "blur" ? newBlur() : newShadow(next === "inner"))}
					/>
				</div>
				<PanelButton
					label={`Remove ${effectLabel(effect).toLowerCase()}`}
					icon="remove"
					tone="danger"
					onClick={onRemove}
				/>
			</div>

			{effect.kind === "blur" ? (
				<NumberInput
					label="Blur radius"
					prefix="R"
					value={effect.radius}
					min={0}
					max={60}
					onChange={(next) => onChange({ ...effect, radius: next })}
				/>
			) : (
				<>
					<PanelPair>
						<NumberInput
							label="Offset across"
							prefix="X"
							value={effect.x}
							min={-200}
							max={200}
							onChange={(next) => onChange({ ...effect, x: next })}
						/>
						<NumberInput
							label="Offset down"
							prefix="Y"
							value={effect.y}
							min={-200}
							max={200}
							onChange={(next) => onChange({ ...effect, y: next })}
						/>
					</PanelPair>
					<PanelPair>
						<NumberInput
							label="Blur"
							prefix="B"
							value={effect.blur}
							min={0}
							max={200}
							onChange={(next) => onChange({ ...effect, blur: next })}
						/>
						<NumberInput
							label="Spread"
							prefix="S"
							value={effect.spread}
							min={-100}
							max={100}
							onChange={(next) => onChange({ ...effect, spread: next })}
						/>
					</PanelPair>
					<PanelPair>
						<ColorInput
							label="Shadow colour"
							required
							value={effect.color}
							fallback="#16161d"
							onChange={(next) => onChange({ ...effect, color: next ?? "#16161d" })}
						/>
						<NumberInput
							label="Shadow opacity in percent"
							prefix="%"
							value={Math.round(effect.opacity * 100)}
							min={0}
							max={100}
							onChange={(next) => onChange({ ...effect, opacity: next / 100 })}
						/>
					</PanelPair>
				</>
			)}
		</div>
	);
}

function EffectsSection({ box, onBox }: BoxSectionProps) {
	const replace = (index: number, effect: MailEffect) =>
		onBox({ effects: box.effects.map((entry, position) => (position === index ? effect : entry)) });

	return (
		<PanelSection
			title="Effects"
			action={
				<PanelButton label="Add effect" icon="add" onClick={() => onBox({ effects: [...box.effects, newShadow(false)] })} />
			}
		>
			{box.effects.map((effect, index) => (
				<EffectRow
					key={`${effect.kind}-${index}`}
					effect={effect}
					onChange={(next) => replace(index, next)}
					onRemove={() => onBox({ effects: box.effects.filter((_entry, position) => position !== index) })}
				/>
			))}
			{box.effects.length > 0 ? (
				<PanelNote tone="warn">Outlook on Windows draws neither shadows nor blur.</PanelNote>
			) : null}
		</PanelSection>
	);
}

type AppearanceSectionProps = {
	hidden: boolean;
	onHidden: (hidden: boolean) => void;
	box: MailBoxStyle;
	onBox: BoxPatch;
	showOpacity?: boolean;
	/** The radius, when this thing has one: the box's own, or a button's. */
	radius?: { value: number; onChange: (value: number) => void } | null;
};

/**
 * Figma's appearance row: the eye, opacity and corner radius, and the button
 * that splits the radius into four corners. Blend modes are left out, because
 * no mail client on the list applies one.
 */
function AppearanceSection({ hidden, onHidden, box, onBox, showOpacity = true, radius = null }: AppearanceSectionProps) {
	const corners = box.corners;
	return (
		<PanelSection
			title="Appearance"
			action={
				<div className="flex items-center">
					<PanelButton
						label={hidden ? "Show in the message" : "Hide from the message"}
						icon={hidden ? "hidden" : "visible"}
						active={hidden}
						onClick={() => onHidden(!hidden)}
					/>
					{radius ? (
						<PanelButton
							label={corners ? "One radius for every corner" : "A radius per corner"}
							icon="corners"
							active={corners !== null}
							onClick={() =>
								onBox({
									corners: corners
										? null
										: {
												topLeft: radius.value,
												topRight: radius.value,
												bottomRight: radius.value,
												bottomLeft: radius.value,
											},
								})
							}
						/>
					) : null}
				</div>
			}
		>
			{hidden ? <PanelNote>Hidden. It stays in the layers and is left out of the message.</PanelNote> : null}
			{showOpacity || radius ? (
				<PanelPair>
					{showOpacity ? (
						<NumberInput
							label="Opacity in percent"
							prefix="%"
							value={Math.round(box.opacity * 100)}
							min={0}
							max={100}
							onChange={(next) => onBox({ opacity: next / 100 })}
						/>
					) : (
						<span />
					)}
					{radius && !corners ? (
						<NumberInput label="Corner radius" prefix="R" value={radius.value} min={0} max={80} onChange={radius.onChange} />
					) : (
						<span />
					)}
				</PanelPair>
			) : null}
			{radius && corners ? (
				<PanelPair>
					<NumberInput
						label="Top left radius"
						prefix="TL"
						value={corners.topLeft}
						min={0}
						max={80}
						onChange={(next) => onBox({ corners: { ...corners, topLeft: next } })}
					/>
					<NumberInput
						label="Top right radius"
						prefix="TR"
						value={corners.topRight}
						min={0}
						max={80}
						onChange={(next) => onBox({ corners: { ...corners, topRight: next } })}
					/>
					<NumberInput
						label="Bottom left radius"
						prefix="BL"
						value={corners.bottomLeft}
						min={0}
						max={80}
						onChange={(next) => onBox({ corners: { ...corners, bottomLeft: next } })}
					/>
					<NumberInput
						label="Bottom right radius"
						prefix="BR"
						value={corners.bottomRight}
						min={0}
						max={80}
						onChange={(next) => onBox({ corners: { ...corners, bottomRight: next } })}
					/>
				</PanelPair>
			) : null}
		</PanelSection>
	);
}

function PaddingSection({ box, onBox }: BoxSectionProps) {
	const sides = [
		["top", "T", "Padding top"],
		["right", "R", "Padding right"],
		["bottom", "B", "Padding bottom"],
		["left", "L", "Padding left"],
	] as const;
	return (
		<PanelSection title="Padding">
			<PanelPair>
				{sides.map(([side, prefix, label]) => (
					<NumberInput
						key={side}
						label={label}
						prefix={prefix}
						value={box.padding[side]}
						min={0}
						max={200}
						onChange={(next) => onBox({ padding: { ...box.padding, [side]: next } })}
					/>
				))}
			</PanelPair>
		</PanelSection>
	);
}

type CustomCssSectionProps = { css: string | null; onChange: (css: string | null) => void };

function CustomCssSection({ css, onChange }: CustomCssSectionProps) {
	return (
		<PanelSection title="Custom CSS">
			<TextInput
				label="Custom CSS declarations"
				multiline
				rows={2}
				mono
				value={css ?? ""}
				placeholder="text-transform:uppercase"
				onChange={(next) => onChange(next || null)}
			/>
			<PanelNote>Declarations only. Anything that places a box is dropped.</PanelNote>
		</PanelSection>
	);
}

type SelectionColorsProps = { colors: string[]; onReplace: (from: string, to: string) => void };

/** A colour input only takes six digits, and the model allows three. */
function sixDigits(color: string): string {
	return color.length === 4
		? `#${color
				.slice(1)
				.split("")
				.map((part) => part + part)
				.join("")}`
		: color;
}

/**
 * Figma's selection colours: every colour used in what is selected, and
 * changing one changes it everywhere in the selection.
 *
 * Keyed by position rather than by colour, because the colour is what is
 * being changed: keyed by it, the picker would be thrown away and closed on
 * every step of a drag across it.
 */
function SelectionColors({ colors, onReplace }: SelectionColorsProps) {
	if (colors.length === 0) return null;
	return (
		<PanelSection title="Selection colours">
			<div className="flex flex-wrap gap-1">
				{colors.map((color, index) => (
					<input
						key={index}
						type="color"
						value={sixDigits(color)}
						title={color}
						aria-label={`Change ${color} everywhere in the selection`}
						onChange={(event) => onReplace(color, event.target.value)}
						className="h-[24px] w-[24px] cursor-pointer rounded-full border border-[var(--line)] bg-transparent p-0.5 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
					/>
				))}
			</div>
		</PanelSection>
	);
}

type BlockLayoutSectionProps = {
	block: MailBlock;
	section: MailSection;
	measured: Measured | null;
	clip: boolean;
	onBlock: (patch: Partial<MailBlock>) => void;
};

/**
 * Figma's resizing and dimensions, for one block: a width and a height that
 * are each fixed, hug or fill, what that means in this section worked out by
 * sizing.ts.
 *
 * W and H always say how big the block is drawn, as Figma's do, so a block
 * that fills shows the width it fills to. Typing a number into either makes
 * that side fixed. A fixed width still gives way on a narrow screen, and a
 * height is the least the block will be, never a clipped one: text longer
 * than it makes the block taller, which is what a message read on a phone
 * needs.
 */
function BlockLayoutSection({ block, section, measured, clip, onBlock }: BlockLayoutSectionProps) {
	const across = widthModes(block, section);
	const down = heightModes(block);
	const width = fixedWidth(block) ?? (measured ? Math.round(measured.width) : null);
	const height = fixedHeight(block) ?? (measured ? Math.round(measured.height) : null);
	const box = "box" in block ? block.box : null;
	const heightMode = heightSizing(block, section);

	return (
		<PanelSection title="Layout">
			{across.length > 0 || down.length > 1 ? (
				<PanelPair>
					{across.length > 0 ? (
						<Segmented
							label="Horizontal resizing"
							value={widthSizing(block, section)}
							options={sizingOptions("width", across)}
							onChange={(mode) => onBlock(sizeWidth(block, section, mode, measured?.width ?? null))}
						/>
					) : (
						<span />
					)}
					{down.length > 1 ? (
						<Segmented
							label="Vertical resizing"
							value={heightMode}
							options={sizingOptions("height", down)}
							onChange={(mode) => onBlock(sizeHeight(block, section, mode, measured?.height ?? null))}
						/>
					) : (
						<span />
					)}
				</PanelPair>
			) : null}

			<PanelPair>
				{across.includes("fixed") ? (
					<NumberInput
						label="Width"
						prefix="W"
						value={width}
						min={1}
						max={900}
						onChange={(next) => onBlock(setWidth(block, section, next))}
					/>
				) : (
					<ReadOnlyValue prefix="W" label="Width" value={width === null ? "Auto" : String(width)} />
				)}
				{down.includes("fixed") ? (
					<NumberInput
						label={block.kind === "spacer" ? "Height" : "Least height"}
						prefix="H"
						value={height}
						min={1}
						max={2000}
						onChange={(next) => onBlock(setHeight(block, section, next))}
					/>
				) : (
					<ReadOnlyValue prefix="H" label="Height" value={height === null ? "Auto" : String(height)} />
				)}
			</PanelPair>

			{block.grow > 0 ? (
				<NumberInput
					label="Share of the room left"
					prefix="x"
					value={block.grow}
					min={1}
					max={12}
					onChange={(next) => onBlock({ grow: next } as Partial<MailBlock>)}
				/>
			) : null}

			{clip && box ? (
				<PanelCheckbox
					label="Clip content"
					checked={box.clip}
					onChange={(checked) => onBlock({ box: { ...box, clip: checked } } as Partial<MailBlock>)}
				/>
			) : null}

			{heightMode === "fixed" && block.kind !== "spacer" ? (
				<PanelNote>The least it will be. Anything longer makes it taller.</PanelNote>
			) : null}
		</PanelSection>
	);
}

type BlockContentProps = {
	block: Exclude<MailBlock, { kind: "html" }>;
	inputs: TemplateInput[];
	set: (patch: Partial<MailBlock>) => void;
};

/** What the block says or shows, per kind. */
function BlockContent({ block, inputs, set }: BlockContentProps) {
	switch (block.kind) {
		case "heading":
			return (
				<PanelSection title="Content">
					<div className="flex items-center gap-1.5">
						<div className="min-w-0 flex-1">
							<TextInput
								label="Heading text"
								value={block.content}
								placeholder="Titel"
								onChange={(next) => set({ content: next } as Partial<MailBlock>)}
							/>
						</div>
						<div className="w-[84px] flex-none">
							<Segmented
								label="Level"
								value={String(block.level)}
								options={[
									{ value: "1", label: "Heading 1", icon: "h1", title: "Heading 1" },
									{ value: "2", label: "Heading 2", icon: "h2", title: "Heading 2" },
									{ value: "3", label: "Heading 3", icon: "h3", title: "Heading 3" },
								]}
								onChange={(next) => set({ level: Number.parseInt(next, 10) as 1 | 2 | 3 } as Partial<MailBlock>)}
							/>
						</div>
					</div>
				</PanelSection>
			);
		case "text":
			return (
				<PanelSection title="Content">
					<TextInput
						label="Text"
						multiline
						rows={4}
						value={block.html}
						placeholder="Tekst"
						onChange={(next) => set({ html: next } as Partial<MailBlock>)}
					/>
					<PanelNote>Double-click the block on the canvas to edit it in place. Placeholders work here.</PanelNote>
				</PanelSection>
			);
		case "button":
			return (
				<PanelSection title="Content">
					<TextInput
						label="Button label"
						value={block.label}
						placeholder="Bekijk"
						onChange={(next) => set({ label: next } as Partial<MailBlock>)}
					/>
					<TextInput
						label="Button link"
						type="url"
						value={block.href}
						placeholder="https://"
						onChange={(next) => set({ href: next } as Partial<MailBlock>)}
					/>
					<PanelPair>
						<ColorInput
							label="Button fill"
							required
							value={block.background}
							onChange={(next) => set({ background: next ?? "#4a3fa0" } as Partial<MailBlock>)}
						/>
						<ColorInput
							label="Label colour"
							required
							value={block.color}
							onChange={(next) => set({ color: next ?? "#ffffff" } as Partial<MailBlock>)}
						/>
					</PanelPair>
					<PanelNote>https or mailto. An http link would leak the reader's address, so it renders as words.</PanelNote>
				</PanelSection>
			);
		case "image":
			return (
				<PanelSection title="Content">
					<TextInput
						label="Image address"
						type="url"
						value={block.src}
						placeholder="https://"
						onChange={(next) => set({ src: next } as Partial<MailBlock>)}
					/>
					<TextInput
						label="Alt text"
						value={block.alt}
						placeholder="What it shows"
						onChange={(next) => set({ alt: next } as Partial<MailBlock>)}
					/>
					<PanelNote>A hosted https address. A picture carried inside the message gets it filed as spam.</PanelNote>
				</PanelSection>
			);
		case "field":
			return (
				<PanelSection title="Content">
					<PanelSelect
						label="Input"
						value={block.inputKey}
						placeholder="Choose an input"
						options={inputs.map((input) => ({
							value: input.key,
							label: `${input.label || input.key} (${input.kind})`,
						}))}
						onChange={(next) => set({ inputKey: next } as Partial<MailBlock>)}
					/>
					{inputs.length === 0 ? (
						<PanelNote>This template asks for nothing yet. Declare an input in the Asks view first.</PanelNote>
					) : null}
				</PanelSection>
			);
		case "divider":
			return (
				<PanelSection title="Content">
					<PanelPair>
						<ColorInput
							label="Divider colour"
							required
							value={block.color}
							fallback="#e3e2ec"
							onChange={(next) => set({ color: next ?? "#e3e2ec" } as Partial<MailBlock>)}
						/>
						<NumberInput
							label="Divider thickness"
							prefix="W"
							value={block.thickness}
							min={1}
							max={20}
							onChange={(next) => set({ thickness: next } as Partial<MailBlock>)}
						/>
					</PanelPair>
				</PanelSection>
			);
		case "spacer":
			return null;
	}
}

type CodeSectionProps = {
	block: Extract<MailBlock, { kind: "html" }>;
	set: (patch: Partial<MailBlock>) => void;
};

/**
 * A code block, as the code it is and nothing else. The CSS is declarations
 * for the element, or for a div around the markup when there is more than one
 * element, which is the same rule the compiler follows.
 */
function CodeSection({ block, set }: CodeSectionProps) {
	return (
		<PanelSection title="Code">
			<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">HTML</span>
			<TextInput
				label="HTML"
				multiline
				rows={9}
				mono
				value={block.html}
				placeholder="<p>Tekst</p>"
				onChange={(next) => set({ html: next } as Partial<MailBlock>)}
			/>
			<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">CSS</span>
			<TextInput
				label="CSS"
				multiline
				rows={5}
				mono
				value={block.css}
				placeholder="padding:16px;background-color:#f6f6fa"
				onChange={(next) => set({ css: next } as Partial<MailBlock>)}
			/>
			<PanelNote>
				The CSS is the element's own style, or a div's around the markup when it is more than one element.
				Declarations only: anything that places a box is dropped, and so are scripts, forms and styles in
				the HTML.
			</PanelNote>
		</PanelSection>
	);
}

type ConvertSectionProps = { onConvert: () => void };

function ConvertSection({ onConvert }: ConvertSectionProps) {
	return (
		<PanelSection title="Code">
			<Button size="dense" onClick={onConvert}>
				Convert to HTML
			</Button>
			<PanelNote>
				The block becomes its own HTML and CSS, edited as code here, and looks exactly as it does now. The
				controls above do not come back.
			</PanelNote>
		</PanelSection>
	);
}

/* ------------------------------------------------------------------- panel */

/**
 * The properties of whatever is selected: the frame, a section, or a block.
 *
 * It follows Figma's panel from top to bottom, minus what a message cannot
 * have. There is no position and no rotation, because nothing in this model
 * is placed or turned: a block sits where its section's flex or grid puts it,
 * and the alignment row moves it across that and nowhere else. There is no
 * blend mode and no export. Everything else is here, and a control that a
 * common mail client ignores says so where it is set. A block converted to
 * HTML shows its code and nothing else.
 */
export function DesignPanel({
	layout,
	inputs,
	selection,
	contentHeight,
	measured,
	fonts,
	onLayout,
	onReplace,
	onSection,
	onBlock,
	onRemoveSection,
	onRemoveBlock,
	onConvert,
}: DesignPanelProps) {
	const section = selection ? (layout.sections.find((entry) => entry.id === selection.sectionId) ?? null) : null;
	const block =
		section && selection?.blockId ? (section.blocks.find((entry) => entry.id === selection.blockId) ?? null) : null;
	const scope = section ? { sectionId: section.id, blockId: block?.id } : null;
	const colors = colorsIn(layout, scope);
	const recolor = (from: string, to: string) => onReplace(replaceColor(layout, scope, from, to));

	if (!section) {
		const floor = Math.ceil(contentHeight);
		return (
			<div className="flex flex-col">
				<div className="flex h-[36px] flex-none items-center border-b border-[var(--line)] px-3">
					<span className="text-[length:var(--text-sm)] font-[var(--weight-semibold)]">Frame</span>
				</div>
				<PanelSection title="Dimensions">
					<PanelPair>
						<NumberInput
							label="Frame width"
							prefix="W"
							value={layout.width}
							min={280}
							max={900}
							onChange={(next) => onLayout({ width: next })}
						/>
						<NumberInput
							label="Frame height"
							prefix="H"
							value={Math.max(layout.minHeight, floor)}
							min={floor}
							max={20000}
							onChange={(next) => onLayout({ minHeight: Math.max(next, floor) })}
						/>
					</PanelPair>
					<PanelNote>
						600 is what mail clients agree on. The height never goes under the {floor} pixels the content
						needs.
					</PanelNote>
				</PanelSection>

				<FillSection fill={layout.fill} onFill={(fill) => onLayout({ fill })} />
				<FontsSection
					fonts={layout.fonts}
					onChange={(next) => onLayout({ fonts: next })}
					status={fonts.status}
					onRetry={fonts.retry}
				/>
				<SelectionColors colors={colors} onReplace={recolor} />
				<CustomCssSection css={layout.customCss} onChange={(customCss) => onLayout({ customCss })} />
			</div>
		);
	}

	if (block) {
		const set = (patch: Partial<MailBlock>) => onBlock(section.id, block.id, patch);

		if (block.kind === "html") {
			return (
				<div className="flex flex-col">
					<Header
						label={BLOCK_KIND_LABELS.html}
						deleteLabel="Delete block"
						onDelete={() => onRemoveBlock(section.id, block.id)}
						hidden={{ value: block.hidden, onChange: (hidden) => set({ hidden } as Partial<MailBlock>) }}
					/>
					<CodeSection block={block} set={set} />
				</div>
			);
		}

		const can = CAN[block.kind];
		const box = "box" in block ? block.box : null;
		const onBox: BoxPatch = (patch) => {
			if (box) set({ box: { ...box, ...patch } } as Partial<MailBlock>);
		};
		const onText = (patch: Partial<MailTextStyle>) => {
			if ("text" in block) set({ text: { ...block.text, ...patch } } as Partial<MailBlock>);
		};
		// Linking a font and setting this text in it is one change, not two:
		// two changes made from the same canvas would have the second undo the
		// first, and the font would be named without ever being linked.
		const linkAndUse = (family: string, fallback: MailFontFallback) => {
			if (!("text" in block)) return;
			const linked = layout.fonts.some((font) => font.family === family)
				? layout
				: {
						...layout,
						fonts: [
							...layout.fonts,
							{ family, source: "google" as const, href: null, weights: [400, 700], italic: false, fallback },
						],
					};
			onReplace(
				updateBlock(linked, section.id, block.id, { text: { ...block.text, fontFamily: family } } as Partial<MailBlock>),
			);
		};
		const radius =
			can.radius === "button" && block.kind === "button"
				? { value: block.radius, onChange: (next: number) => set({ radius: next } as Partial<MailBlock>) }
				: can.radius === "box" && box
					? { value: box.borderRadius, onChange: (next: number) => onBox({ borderRadius: next }) }
					: null;

		return (
			<div className="flex flex-col">
				<Header
					label={BLOCK_KIND_LABELS[block.kind]}
					deleteLabel="Delete block"
					onDelete={() => onRemoveBlock(section.id, block.id)}
					// A spacer has no appearance section, so its eye is up here.
					hidden={
						box ? undefined : { value: block.hidden, onChange: (hidden) => set({ hidden } as Partial<MailBlock>) }
					}
				/>
				<AlignmentSection
					axis={crossAxis(section)}
					value={acrossOf(block, section)}
					onChange={(across) => set(alignAcross(block, section, across))}
				/>
				<BlockContent block={block} inputs={inputs} set={set} />
				<BlockLayoutSection block={block} section={section} measured={measured} clip={can.clip} onBlock={set} />
				{"text" in block ? (
					<TypographySection
						text={block.text}
						onText={onText}
						fonts={layout.fonts}
						onLinkAndUse={linkAndUse}
						showColor={block.kind !== "button"}
						showVertical={block.kind === "text" || block.kind === "heading"}
					/>
				) : null}
				{box ? (
					<AppearanceSection
						hidden={block.hidden}
						onHidden={(hidden) => set({ hidden } as Partial<MailBlock>)}
						box={box}
						onBox={onBox}
						showOpacity={can.opacity}
						radius={radius}
					/>
				) : null}
				{can.fill && box ? <FillSection fill={box.fill} onFill={(fill) => onBox({ fill })} /> : null}
				{can.stroke && box ? <StrokeSection box={box} onBox={onBox} /> : null}
				{can.effects && box ? <EffectsSection box={box} onBox={onBox} /> : null}
				{can.padding && box ? <PaddingSection box={box} onBox={onBox} /> : null}
				<SelectionColors colors={colors} onReplace={recolor} />
				{box ? <CustomCssSection css={box.customCss} onChange={(customCss) => onBox({ customCss })} /> : null}
				<ConvertSection onConvert={() => onConvert(section.id, block.id)} />
			</div>
		);
	}

	const arrangement = section.layout;
	const onSectionBox: BoxPatch = (patch) => onSection(section.id, { box: { ...section.box, ...patch } });
	const flow = arrangement.kind === "grid" ? "grid" : arrangement.direction === "row" ? "across" : "down";
	const axis = crossAxis(section);
	// The distribution drawings run across; down a column they are turned.
	const turned = arrangement.kind === "flex" && arrangement.direction === "column" ? "rotate-90" : undefined;

	return (
		<div className="flex flex-col">
			<Header label="Section" deleteLabel="Delete section" onDelete={() => onRemoveSection(section.id)} />

			<PanelSection
				title="Layout"
				action={
					arrangement.kind === "flex" ? (
						<PanelButton
							label={arrangement.wrap ? "Stop wrapping onto the next line" : "Wrap onto the next line"}
							icon="wrap"
							active={arrangement.wrap}
							onClick={() => onSection(section.id, { layout: { ...arrangement, wrap: !arrangement.wrap } })}
						/>
					) : null
				}
			>
				<TextInput
					label="Section name"
					value={section.name}
					placeholder="Section"
					onChange={(next) => onSection(section.id, { name: next })}
				/>
				<Segmented
					label="Flow"
					value={flow}
					options={[
						{ value: "down", label: "Down", icon: "move-down", title: "Down the page" },
						{ value: "across", label: "Across", icon: "move-right", title: "Across the page" },
						{ value: "grid", label: "Grid", icon: "grid", title: "In a grid" },
					]}
					onChange={(next) =>
						onSection(section.id, {
							layout:
								next === "grid"
									? { kind: "grid", columns: 2, gap: arrangement.gap, align: arrangement.align }
									: {
											kind: "flex",
											direction: next === "across" ? "row" : "column",
											justify: arrangement.kind === "flex" ? arrangement.justify : "start",
											align: arrangement.align,
											gap: arrangement.gap,
											wrap: arrangement.kind === "flex" ? arrangement.wrap : false,
										},
						})
					}
				/>

				{arrangement.kind === "flex" ? (
					<Segmented
						label="Distribute"
						value={arrangement.justify}
						options={[
							{ value: "start", label: "Start", icon: "justify-start", title: "Packed at the start", iconClass: turned },
							{ value: "center", label: "Centre", icon: "justify-center", title: "Packed in the middle", iconClass: turned },
							{ value: "end", label: "End", icon: "justify-end", title: "Packed at the end", iconClass: turned },
							{ value: "between", label: "Space between", icon: "justify-between", title: "Space between", iconClass: turned },
							{ value: "around", label: "Space around", icon: "justify-around", title: "Space around", iconClass: turned },
						]}
						onChange={(next) => onSection(section.id, { layout: { ...arrangement, justify: next } })}
					/>
				) : null}

				<Segmented
					label="Align items"
					value={arrangement.align}
					options={alignOptions(axis)}
					onChange={(next) => onSection(section.id, { layout: { ...arrangement, align: next } })}
				/>

				<PanelPair>
					<NumberInput
						label="Gap between blocks"
						prefix="Gap"
						value={arrangement.gap}
						min={0}
						max={120}
						onChange={(next) => onSection(section.id, { layout: { ...arrangement, gap: next } })}
					/>
					{arrangement.kind === "grid" ? (
						<NumberInput
							label="Columns"
							prefix="Col"
							value={arrangement.columns}
							min={1}
							max={6}
							onChange={(next) => onSection(section.id, { layout: { ...arrangement, columns: Math.round(next) } })}
						/>
					) : (
						<span />
					)}
				</PanelPair>

				{/* A section sits in the frame, which lays its sections one under
				    the next: it fills the width or has its own, and hugs what is in
				    it or has a least height. */}
				<PanelPair>
					<Segmented
						label="Horizontal resizing"
						value={section.box.width !== null ? "fixed" : "fill"}
						options={sizingOptions("width", ["fixed", "fill"])}
						onChange={(next) =>
							onSectionBox({ width: next === "fixed" ? Math.round(measured?.width ?? layout.width) : null })
						}
					/>
					<Segmented
						label="Vertical resizing"
						value={section.box.minHeight !== null ? "fixed" : "hug"}
						options={sizingOptions("height", ["fixed", "hug"])}
						onChange={(next) =>
							onSectionBox({ minHeight: next === "fixed" ? Math.round(measured?.height ?? 120) : null })
						}
					/>
				</PanelPair>
				<PanelPair>
					<NumberInput
						label="Width"
						prefix="W"
						value={section.box.width ?? (measured ? Math.round(measured.width) : null)}
						min={8}
						max={900}
						onChange={(next) => onSectionBox({ width: next })}
					/>
					<NumberInput
						label="Least height"
						prefix="H"
						value={section.box.minHeight ?? (measured ? Math.round(measured.height) : null)}
						min={1}
						max={4000}
						onChange={(next) => onSectionBox({ minHeight: next })}
					/>
				</PanelPair>
				<PanelCheckbox label="Clip content" checked={section.box.clip} onChange={(clip) => onSectionBox({ clip })} />

				<PanelNote tone="warn">
					Outlook on Windows stacks this section into one column and drops the gap and the alignment.
				</PanelNote>
			</PanelSection>

			<AppearanceSection
				hidden={section.hidden}
				onHidden={(hidden) => onSection(section.id, { hidden })}
				box={section.box}
				onBox={onSectionBox}
				radius={{ value: section.box.borderRadius, onChange: (next) => onSectionBox({ borderRadius: next }) }}
			/>
			<FillSection fill={section.box.fill} onFill={(fill) => onSectionBox({ fill })} />
			<StrokeSection box={section.box} onBox={onSectionBox} />
			<EffectsSection box={section.box} onBox={onSectionBox} />
			<PaddingSection box={section.box} onBox={onSectionBox} />
			<SelectionColors colors={colors} onReplace={recolor} />
			<CustomCssSection css={section.box.customCss} onChange={(customCss) => onSectionBox({ customCss })} />
		</div>
	);
}
