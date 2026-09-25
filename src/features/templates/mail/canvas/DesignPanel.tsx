import { useState } from "react";
import type {
	MailAlign,
	MailBlock,
	MailBoxStyle,
	MailCorners,
	MailFontFallback,
	MailLayout,
	MailSection,
	MailSpacing,
	MailTextStyle,
	TemplateInput,
} from "@shared/types";
import { Button } from "../../../../components/Button";
import { isMac } from "../../../../lib/platform";
import { BreakpointsSection } from "./BreakpointsSection";
import { BLOCK_KIND_LABELS, colorsIn, replaceColor, updateBlock } from "./canvas-actions";
import type { Measured, Selection } from "./CanvasView";
import { ColorRow } from "./ColorRow";
import { EffectsSection } from "./EffectsSection";
import { FillSection } from "./FillSection";
import { FontsSection } from "./FontsSection";
import {
	DimensionInput,
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
	flowOf,
	heightModes,
	heightSizing,
	setHeight,
	setWidth,
	sizeHeight,
	sizeWidth,
	widthModes,
	widthSizing,
	type Across,
} from "./sizing";
import { StrokeSection } from "./StrokeSection";
import { TypographySection } from "./TypographySection";
import type { CanvasFonts } from "./use-canvas-fonts";

type DesignPanelProps = {
	/** The canvas as it is stored, breakpoints and all. */
	base: MailLayout;
	/** The breakpoint being edited, or null for the default. */
	active: string | null;
	onActive: (id: string | null) => void;
	/** A change to the stored canvas itself: adding, naming and removing breakpoints. */
	onBase: (next: MailLayout) => void;
	/**
	 * The canvas as the selected breakpoint draws it. Every control reads this
	 * and changes this, and the editor folds the change back into the
	 * breakpoint or the default.
	 */
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
 * and not a control that changes nothing in the message. A button's fill is
 * the button's own colour. A divider and a spacer are what templates made
 * before sections did their job still have, and keep what they had.
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

const BOXED: Capabilities = { fill: true, stroke: true, effects: true, radius: "box", opacity: true, padding: true, clip: true };

const CAN: Record<Exclude<MailBlock["kind"], "html">, Capabilities> = {
	text: BOXED,
	heading: BOXED,
	field: BOXED,
	button: { ...BOXED, fill: false, radius: "button", clip: false },
	image: { ...BOXED, clip: false },
	divider: { fill: false, stroke: false, effects: false, radius: null, opacity: true, padding: true, clip: false },
	spacer: { fill: false, stroke: false, effects: false, radius: null, opacity: false, padding: false, clip: false },
};

/** The cross axis of a section, which is the one a block's own alignment moves it along. */
function crossAxis(section: MailSection): Axis {
	return flowOf(section) === "column" ? "h" : "v";
}

const ALT = isMac ? "Option" : "Alt";

function acrossOptions(axis: Axis, keys = true): SegmentedOption<Across>[] {
	const withKey = (title: string, key: string) => (keys ? `${title} (${ALT}+${key})` : title);
	return axis === "h"
		? [
				{ value: "start", label: "Left", icon: "self-h-start", title: withKey("Align left", "A") },
				{ value: "center", label: "Centre", icon: "self-h-center", title: withKey("Align centre", "H") },
				{ value: "end", label: "Right", icon: "self-h-end", title: withKey("Align right", "D") },
			]
		: [
				{ value: "start", label: "Top", icon: "self-v-start", title: withKey("Align top", "W") },
				{ value: "center", label: "Middle", icon: "self-v-center", title: withKey("Align middle", "V") },
				{ value: "end", label: "Bottom", icon: "self-v-end", title: withKey("Align bottom", "S") },
			];
}

/** The same, and stretching, for where a section puts everything in it. */
function alignOptions(axis: Axis): SegmentedOption<MailAlign>[] {
	return [
		...acrossOptions(axis, false),
		axis === "h"
			? { value: "stretch", label: "Stretch", icon: "self-h-stretch", title: "Stretch across" }
			: { value: "stretch", label: "Stretch", icon: "self-v-stretch", title: "Stretch down" },
	];
}

/* ------------------------------------------------------------------ pieces */

type HeaderProps = {
	label: string;
	/** A section is named here, the way a frame is renamed in Figma's layers. */
	name?: { value: string; onChange: (name: string) => void };
	deleteLabel?: string;
	onDelete?: () => void;
	/** The eye, where there is no appearance section to hold it. */
	hidden?: { value: boolean; onChange: (hidden: boolean) => void };
};

/** The top row: what is selected, and deleting it. Reordering is a drag in the layers. */
function Header({ label, name, deleteLabel, onDelete, hidden }: HeaderProps) {
	return (
		<div className="flex h-[36px] flex-none items-center gap-0.5 border-b border-[var(--line)] pr-1.5 pl-3">
			{name ? (
				<input
					value={name.value}
					aria-label={`${label} name`}
					placeholder={label}
					onChange={(event) => name.onChange(event.target.value)}
					className="-ml-1.5 h-[28px] min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 text-[length:var(--text-sm)] font-[var(--weight-semibold)] text-[var(--ink)] hover:bg-[var(--sunken)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none"
				/>
			) : (
				<span className="flex-1 truncate text-[length:var(--text-sm)] font-[var(--weight-semibold)]">{label}</span>
			)}
			{hidden ? (
				<PanelButton
					label={hidden.value ? "Show in the message" : "Hide from the message"}
					icon={hidden.value ? "hidden" : "visible"}
					active={hidden.value}
					onClick={() => hidden.onChange(!hidden.value)}
				/>
			) : null}
			{onDelete && deleteLabel ? <PanelButton label={deleteLabel} icon="remove" tone="danger" onClick={onDelete} /> : null}
		</div>
	);
}

type PositionSectionProps = {
	axis: Axis;
	value: Across | null;
	onChange: (value: Across | null) => void;
};

/**
 * Figma's alignment row, which here moves a block across its section rather
 * than to a coordinate: the three across and the three down, with the ones
 * that do not apply in this section greyed out, as Figma greys them in an auto
 * layout. There is no X and no Y, because nothing in a message is placed at a
 * point. Pressing the pressed one goes back to what the section says.
 */
function PositionSection({ axis, value, onChange }: PositionSectionProps) {
	return (
		<PanelSection title="Position">
			<PanelPair>
				<Segmented
					label="Align across"
					value={axis === "h" ? value : null}
					options={acrossOptions("h")}
					onChange={onChange}
					onClear={() => onChange(null)}
					disabled={axis !== "h"}
				/>
				<Segmented
					label="Align down"
					value={axis === "v" ? value : null}
					options={acrossOptions("v")}
					onChange={onChange}
					onClear={() => onChange(null)}
					disabled={axis !== "v"}
				/>
			</PanelPair>
		</PanelSection>
	);
}

type PaddingFieldsProps = { padding: MailSpacing; onChange: (padding: MailSpacing) => void };

/**
 * Figma's padding: across and down as two numbers, or each side on its own
 * behind the button beside them. Sides that differ open on their own.
 */
function PaddingFields({ padding, onChange }: PaddingFieldsProps) {
	const even = padding.left === padding.right && padding.top === padding.bottom;
	const [split, setSplit] = useState(!even);
	const apart = split || !even;
	return (
		<div className="flex items-start gap-0.5">
			<div className="min-w-0 flex-1">
				{apart ? (
					<PanelPair>
						{(
							[
								["top", "T", "Padding top"],
								["right", "R", "Padding right"],
								["bottom", "B", "Padding bottom"],
								["left", "L", "Padding left"],
							] as const
						).map(([side, prefix, label]) => (
							<NumberInput
								key={side}
								label={label}
								prefix={prefix}
								value={padding[side]}
								min={0}
								max={200}
								onChange={(next) => onChange({ ...padding, [side]: next })}
							/>
						))}
					</PanelPair>
				) : (
					<PanelPair>
						<NumberInput
							label="Padding left and right"
							prefix="↔"
							value={padding.left}
							min={0}
							max={200}
							onChange={(next) => onChange({ ...padding, left: next, right: next })}
						/>
						<NumberInput
							label="Padding top and bottom"
							prefix="↕"
							value={padding.top}
							min={0}
							max={200}
							onChange={(next) => onChange({ ...padding, top: next, bottom: next })}
						/>
					</PanelPair>
				)}
			</div>
			<PanelButton
				label={apart ? "The same padding on opposite sides" : "Padding for each side"}
				icon="corners"
				active={apart}
				onClick={() => {
					if (apart && !even) onChange({ ...padding, right: padding.left, bottom: padding.top });
					setSplit(!apart);
				}}
			/>
		</div>
	);
}

/** A corner radius and where it is kept: a box's own, or a button's. */
type Radius = { value: number; onChange: (value: number) => void };

type RadiusFieldsProps = {
	radius: Radius;
	corners: MailCorners | null;
	onCorners: (corners: MailCorners | null) => void;
};

/**
 * The corner radius, one for every corner or one each, beside the size it
 * rounds. Outlook on Windows draws every corner square.
 */
function RadiusFields({ radius, corners, onCorners }: RadiusFieldsProps) {
	return (
		<div className="flex items-center gap-0.5">
			<div className="min-w-0 flex-1">
				{corners ? (
					<PanelPair>
						{(
							[
								["topLeft", "TL", "Top left radius"],
								["topRight", "TR", "Top right radius"],
								["bottomLeft", "BL", "Bottom left radius"],
								["bottomRight", "BR", "Bottom right radius"],
							] as const
						).map(([corner, prefix, label]) => (
							<NumberInput
								key={corner}
								label={label}
								prefix={prefix}
								value={corners[corner]}
								min={0}
								max={80}
								onChange={(next) => onCorners({ ...corners, [corner]: next })}
							/>
						))}
					</PanelPair>
				) : (
					<NumberInput
						label="Corner radius"
						prefix="Radius"
						value={radius.value}
						min={0}
						max={80}
						onChange={radius.onChange}
					/>
				)}
			</div>
			<PanelButton
				label={corners ? "One radius for every corner" : "A radius for each corner"}
				icon="corners"
				active={corners !== null}
				onClick={() =>
					onCorners(
						corners
							? null
							: { topLeft: radius.value, topRight: radius.value, bottomRight: radius.value, bottomLeft: radius.value },
					)
				}
			/>
		</div>
	);
}

type BlockLayoutProps = {
	block: MailBlock;
	section: MailSection;
	measured: Measured | null;
	can: Capabilities | null;
	/** The corners, when this block has them. */
	radius: Radius | null;
	onBlock: (patch: Partial<MailBlock>) => void;
};

/**
 * Figma's layout for one block: W and H, each with whether it is fixed, hugs
 * or fills, what that means in this section worked out by sizing.ts; then
 * how round its corners are, the room inside it, and whether what reaches past
 * it is cut off.
 *
 * W and H always say how big the block is drawn, so a block that fills shows
 * the width it fills to, and typing a number fixes that side at it. A fixed
 * width still gives way on a narrow screen, and a height is the least the
 * block will be: text longer than it makes the block taller.
 */
function BlockLayoutSection({ block, section, measured, can, radius, onBlock }: BlockLayoutProps) {
	const across = widthModes(block, section);
	const down = heightModes(block);
	const width = fixedWidth(block) ?? (measured ? Math.round(measured.width) : null);
	const height = fixedHeight(block) ?? (measured ? Math.round(measured.height) : null);
	const box = "box" in block ? block.box : null;
	const heightMode = heightSizing(block, section);

	return (
		<PanelSection title="Layout">
			<PanelPair>
				<DimensionInput
					prefix="W"
					label="Width"
					value={width}
					editable={across.includes("fixed")}
					onValue={(next) => onBlock(setWidth(block, section, next))}
					mode={widthSizing(block, section)}
					modes={across}
					onMode={(mode) => onBlock(sizeWidth(block, section, mode, measured?.width ?? null))}
					max={1600}
				/>
				<DimensionInput
					prefix="H"
					label="Height"
					value={height}
					editable={down.includes("fixed")}
					onValue={(next) => onBlock(setHeight(block, section, next))}
					mode={heightMode}
					modes={down}
					onMode={(mode) => onBlock(sizeHeight(block, section, mode, measured?.height ?? null))}
				/>
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

			{radius && box ? (
				<RadiusFields
					radius={radius}
					corners={box.corners}
					onCorners={(corners) => onBlock({ box: { ...box, corners } } as Partial<MailBlock>)}
				/>
			) : null}

			{can?.padding && box ? (
				<PaddingFields padding={box.padding} onChange={(padding) => onBlock({ box: { ...box, padding } } as Partial<MailBlock>)} />
			) : null}

			{can?.clip && box ? (
				<PanelCheckbox
					label="Clip content"
					checked={box.clip}
					onChange={(clip) => onBlock({ box: { ...box, clip } } as Partial<MailBlock>)}
				/>
			) : null}

			{heightMode === "fixed" && block.kind !== "spacer" ? (
				<PanelNote>The least it will be. Anything longer makes it taller.</PanelNote>
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
};

/**
 * Figma's appearance: whether the thing shows, and how see-through it is.
 * Blend modes are left out, because no mail client on the list applies one,
 * and the corners are with the size, under Layout.
 */
function AppearanceSection({ hidden, onHidden, box, onBox, showOpacity = true }: AppearanceSectionProps) {
	return (
		<PanelSection
			title="Appearance"
			action={
				<PanelButton
					label={hidden ? "Show in the message" : "Hide from the message"}
					icon={hidden ? "hidden" : "visible"}
					active={hidden}
					onClick={() => onHidden(!hidden)}
				/>
			}
		>
			{hidden ? <PanelNote>Hidden. It stays in the layers and is left out of the message.</PanelNote> : null}
			{showOpacity ? (
				<NumberInput
					label="Opacity"
					prefix="Opacity"
					suffix="%"
					value={Math.round(box.opacity * 100)}
					min={0}
					max={100}
					onChange={(next) => onBox({ opacity: next / 100 })}
				/>
			) : null}
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
			{colors.map((color, index) => (
				<ColorRow key={index} label="Selection colour" value={color} onChange={(next) => onReplace(color, next)} />
			))}
		</PanelSection>
	);
}

type ContentProps = {
	block: Exclude<MailBlock, { kind: "html" }>;
	inputs: TemplateInput[];
	set: (patch: Partial<MailBlock>) => void;
};

/**
 * What a block links to, shows or asks for, where that is not typed on the
 * canvas: a button's words and address, a picture's address and alt text,
 * which input an input block is. Text and headings are typed on the canvas and
 * have nothing here.
 */
function ContentSection({ block, inputs, set }: ContentProps) {
	switch (block.kind) {
		case "button":
			return (
				<PanelSection title="Link">
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
					<PanelNote>https or mailto. An http link would leak the reader's address, so it renders as words.</PanelNote>
				</PanelSection>
			);
		case "image":
			return (
				<PanelSection title="Image">
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
				<PanelSection title="Input">
					<PanelSelect
						label="Input"
						value={block.inputKey}
						placeholder="Choose an input"
						options={inputs.map((input) => ({ value: input.key, label: `${input.label || input.key} (${input.kind})` }))}
						onChange={(next) => set({ inputKey: next } as Partial<MailBlock>)}
					/>
					{inputs.length === 0 ? (
						<PanelNote>This template asks for nothing yet. Declare an input in the Asks view first.</PanelNote>
					) : null}
				</PanelSection>
			);
		case "divider":
			return (
				<PanelSection title="Line">
					<ColorRow label="Line colour" value={block.color} onChange={(color) => set({ color } as Partial<MailBlock>)} />
					<NumberInput
						label="Line thickness"
						prefix="W"
						value={block.thickness}
						min={1}
						max={20}
						onChange={(thickness) => set({ thickness } as Partial<MailBlock>)}
					/>
					<PanelNote>A section with a height and a fill, or a stroke on one side, does this for a new message.</PanelNote>
				</PanelSection>
			);
		default:
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
				The CSS is the element's own style, or a div's around the markup when it is more than one element. Declarations
				only: anything that places a box is dropped, and so are scripts, forms and styles in the HTML.
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
				The block becomes its own HTML and CSS, edited as code here, and looks exactly as it does now. The controls
				above do not come back.
			</PanelNote>
		</PanelSection>
	);
}

/* ------------------------------------------------------------------- panel */

/**
 * The properties of whatever is selected: the frame, a section or a block,
 * in Figma's order. Breakpoints first, because they decide which width every
 * control below is changing; then position, layout with the size and the
 * corners, appearance, type, fill, stroke and effects.
 *
 * There is no X, no Y and no rotation, because nothing in a message is placed
 * or turned: a block sits where its section's flex or grid puts it, and the
 * position row moves it across that and nowhere else. There is no blend mode
 * and no export. A control that a common mail client ignores says so where it
 * is set. A block converted to HTML shows its code and nothing else.
 */
export function DesignPanel({
	base,
	active,
	onActive,
	onBase,
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
	const breakpoints = <BreakpointsSection layout={base} active={active} onActive={onActive} onLayout={onBase} />;

	if (!section) {
		const floor = Math.ceil(contentHeight);
		return (
			<div className="flex flex-col">
				{breakpoints}
				<Header label="Frame" />
				<PanelSection title="Layout">
					<PanelPair>
						<DimensionInput
							prefix="W"
							label={active ? "Breakpoint width" : "Frame width"}
							value={layout.width}
							editable
							onValue={(width) => onLayout({ width })}
							mode={layout.widthMode}
							modes={["fill", "fixed"]}
							onMode={(mode) => onLayout({ widthMode: mode === "fixed" ? "fixed" : "fill" })}
							modeLabels={{ fill: "Fill", fixed: "Fixed" }}
							min={280}
							max={1600}
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
						{layout.widthMode === "fill"
							? `The message fills the reader's mail client. ${layout.width} is the width it is drawn at here.`
							: `The message is never wider than ${layout.width}, and sits in the middle of a wider client.`}{" "}
						The height never goes under the {floor} pixels the content needs.
					</PanelNote>
				</PanelSection>
				<FillSection fill={layout.fill} onFill={(fill) => onLayout({ fill })} />
				<FontsSection fonts={layout.fonts} onChange={(next) => onLayout({ fonts: next })} status={fonts.status} onRetry={fonts.retry} />
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
					{breakpoints}
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
			onReplace(updateBlock(linked, section.id, block.id, { text: { ...block.text, fontFamily: family } } as Partial<MailBlock>));
		};
		const radius =
			can.radius === "button" && block.kind === "button"
				? { value: block.radius, onChange: (next: number) => set({ radius: next } as Partial<MailBlock>) }
				: can.radius === "box" && box
					? { value: box.borderRadius, onChange: (next: number) => onBox({ borderRadius: next }) }
					: null;

		return (
			<div className="flex flex-col">
				{breakpoints}
				<Header
					label={BLOCK_KIND_LABELS[block.kind]}
					deleteLabel="Delete block"
					onDelete={() => onRemoveBlock(section.id, block.id)}
					// A spacer has no appearance section, so its eye is up here.
					hidden={box ? undefined : { value: block.hidden, onChange: (hidden) => set({ hidden } as Partial<MailBlock>) }}
				/>
				<PositionSection
					axis={crossAxis(section)}
					value={acrossOf(block, section)}
					onChange={(across) => set(alignAcross(block, section, across))}
				/>
				<BlockLayoutSection block={block} section={section} measured={measured} can={can} radius={radius} onBlock={set} />
				{box ? (
					<AppearanceSection
						hidden={block.hidden}
						onHidden={(hidden) => set({ hidden } as Partial<MailBlock>)}
						box={box}
						onBox={onBox}
						showOpacity={can.opacity}
					/>
				) : null}
				{"text" in block ? (
					<TypographySection
						text={block.text}
						onText={onText}
						fonts={layout.fonts}
						onLinkAndUse={linkAndUse}
						color={
							block.kind === "button"
								? {
										value: block.color,
										onChange: (color) => set({ color: color ?? "#ffffff" } as Partial<MailBlock>),
										clearable: false,
									}
								: { value: block.text.color, onChange: (color) => onText({ color }), clearable: true }
						}
						level={
							block.kind === "heading"
								? { value: block.level, onChange: (level) => set({ level } as Partial<MailBlock>) }
								: undefined
						}
						showVertical={block.kind === "text" || block.kind === "heading"}
					/>
				) : null}
				<ContentSection block={block} inputs={inputs} set={set} />
				{block.kind === "button" ? (
					<PanelSection title="Fill">
						<ColorRow
							label="Button fill"
							value={block.background}
							onChange={(background) => set({ background } as Partial<MailBlock>)}
						/>
					</PanelSection>
				) : null}
				{can.fill && box ? <FillSection fill={box.fill} onFill={(fill) => onBox({ fill })} /> : null}
				{can.stroke && box ? <StrokeSection box={box} onBox={onBox} /> : null}
				{can.effects && box ? <EffectsSection box={box} onBox={onBox} /> : null}
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
	const narrower = section.box.width !== null;

	return (
		<div className="flex flex-col">
			{breakpoints}
			<Header
				label="Section"
				name={{ value: section.name, onChange: (name) => onSection(section.id, { name }) }}
				deleteLabel="Delete section"
				onDelete={() => onRemoveSection(section.id)}
			/>

			<PanelSection title="Position">
				<Segmented
					label="Where the section sits across the frame"
					value={narrower ? (section.alignSelf === "center" || section.alignSelf === "end" ? section.alignSelf : "start") : null}
					options={acrossOptions("h", false)}
					onChange={(alignSelf) => onSection(section.id, { alignSelf })}
					disabled={!narrower}
				/>
				{!narrower ? <PanelNote>A section that fills the frame has nowhere to move. Give it a fixed width.</PanelNote> : null}
			</PanelSection>

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

				{/* A section sits in the frame, which lays its sections one under the
				    next: it fills the width or has its own, and hugs what is in it or
				    has a height. An empty one with a height is a divider or a gap. */}
				<PanelPair>
					<DimensionInput
						prefix="W"
						label="Width"
						value={section.box.width ?? (measured ? Math.round(measured.width) : null)}
						editable
						onValue={(width) => onSectionBox({ width })}
						mode={narrower ? "fixed" : "fill"}
						modes={["fixed", "fill"]}
						onMode={(mode) => onSectionBox({ width: mode === "fixed" ? Math.round(measured?.width ?? layout.width) : null })}
						max={1600}
					/>
					<DimensionInput
						prefix="H"
						label="Height"
						value={section.box.minHeight ?? (measured ? Math.round(measured.height) : null)}
						editable
						onValue={(minHeight) => onSectionBox({ minHeight })}
						mode={section.box.minHeight !== null ? "fixed" : "hug"}
						modes={["fixed", "hug"]}
						onMode={(mode) =>
							onSectionBox({ minHeight: mode === "fixed" ? Math.round(measured?.height ?? 120) : null })
						}
						min={1}
						max={4000}
					/>
				</PanelPair>

				<Segmented
					label="Align items"
					value={arrangement.align}
					options={alignOptions(axis)}
					onChange={(next) => onSection(section.id, { layout: { ...arrangement, align: next } })}
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

				<RadiusFields
					radius={{ value: section.box.borderRadius, onChange: (next) => onSectionBox({ borderRadius: next }) }}
					corners={section.box.corners}
					onCorners={(corners) => onSectionBox({ corners })}
				/>
				<PaddingFields padding={section.box.padding} onChange={(padding) => onSectionBox({ padding })} />
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
			/>
			<FillSection fill={section.box.fill} onFill={(fill) => onSectionBox({ fill })} />
			<StrokeSection box={section.box} onBox={onSectionBox} />
			<EffectsSection box={section.box} onBox={onSectionBox} />
			<SelectionColors colors={colors} onReplace={recolor} />
			<CustomCssSection css={section.box.customCss} onChange={(customCss) => onSectionBox({ customCss })} />
		</div>
	);
}
