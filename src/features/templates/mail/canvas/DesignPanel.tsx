import { useState } from "react";
import type {
	MailAction,
	MailBlock,
	MailBoxStyle,
	MailColumns,
	MailColumnsCell,
	MailContainer,
	MailContainerTag,
	MailFontFallback,
	MailHeadingTag,
	MailLayout,
	MailSectionLayout,
	MailSelfAlign,
	MailSpacing,
	MailTextStyle,
	MailTextTag,
	TemplateInput,
	MailVerticalAlign,
} from "@shared/types";
import { Button } from "../../../../components/Button";
import type { IconName } from "../../../../components/Icon";
import { isMac } from "../../../../lib/platform";
import {
	flowNameOf,
	isStretched,
	litAt,
	place,
	setSpread,
	setStretch,
	spreadOf,
	stretchAxes,
	withFlow,
	type Axis as PageAxis,
	type LayoutFlow,
} from "./alignment";
import { ActionsSection } from "./ActionsSection";
import { flowAutoSides, pictureAutoSides, type AutoSides } from "./box-style";
import { BreakpointsSection } from "./BreakpointsSection";
import {
	addCell,
	addRow,
	BLOCK_KIND_LABELS,
	clickBlockedReason,
	colorsIn,
	CONTAINER_TAG_LABELS,
	defaultText,
	findCell,
	findNode,
	locateCell,
	parentOf,
	removeCell,
	removeRow,
	replaceColor,
	setActions,
	setContainerTag,
	setTextTag,
	updateBlock,
	updateCell,
	updateColumns,
} from "./canvas-actions";
import type { Measured, Selection } from "./CanvasView";
import { ColorRow } from "./ColorRow";
import { EffectsSection } from "./EffectsSection";
import { elementInfo, groupInfo } from "./elements";
import { FillSection } from "./FillSection";
import { FontsSection } from "./FontsSection";
import {
	AlignmentBox,
	DimensionInput,
	GapInput,
	NumberInput,
	PanelButton,
	PanelCheckbox,
	PanelNote,
	PanelPair,
	PanelSection,
	PanelSelect,
	Segmented,
	TextInput,
	type GapMode,
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
	type Placer,
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
	onLayout: (patch: Partial<Omit<MailLayout, "children" | "version">>) => void;
	/** A change that reaches across the whole canvas at once, like a selection colour. */
	onReplace: (layout: MailLayout) => void;
	onSection: (id: string, patch: Partial<Omit<MailContainer, "id" | "kind" | "children">>) => void;
	onColumns: (id: string, patch: Partial<Omit<MailColumns, "id" | "kind" | "rows">>) => void;
	/** How a cell looks. Its width and alignment are structure, and go through `onBase`. */
	onCell: (id: string, patch: Partial<Pick<MailColumnsCell, "box">>) => void;
	onBlock: (id: string, patch: Partial<MailBlock>) => void;
	/** Removes a container, a columns table or a block, wherever it is. */
	onRemove: (id: string) => void;
	/** Turns a block, or a container or columns table with everything in it, into the HTML and CSS it compiles to. */
	onConvert: (nodeId: string) => void;
	/** Points the panel at another node, which a cell removed from its table needs to hand back to the table. */
	onSelect: (selection: Selection) => void;
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
	margin: boolean;
};

// Clip content is not here: it is for containers and cells, and never for text.
const BOXED: Capabilities = { fill: true, stroke: true, effects: true, radius: "box", opacity: true, padding: true, margin: true };

const CAN: Record<Exclude<MailBlock["kind"], "html">, Capabilities> = {
	text: BOXED,
	heading: BOXED,
	field: BOXED,
	button: { ...BOXED, fill: false, radius: "button" },
	image: BOXED,
	divider: { fill: false, stroke: false, effects: false, radius: null, opacity: true, padding: true, margin: true },
	spacer: { fill: false, stroke: false, effects: false, radius: null, opacity: false, padding: false, margin: false },
};

/** The cross axis of a section, which is the one a block's own alignment moves it along. */
function crossAxis(section: MailContainer): Axis {
	return flowOf(section) === "column" ? "h" : "v";
}

/**
 * What lays a node out, as sizing.ts wants it: the container it sits in, or
 * null when it sits in the frame or a table cell, which lay what is in them
 * out in plain flow and have no share of the room or alignment to give.
 */
function placerOf(layout: MailLayout, id: string): Placer {
	const parentId = parentOf(layout, id);
	if (!parentId) return null;
	const parent = findNode(layout, parentId);
	return parent && parent.kind === "container" ? parent : null;
}

/**
 * A container or a columns table read as the block sizing.ts works on. They
 * share what it looks at: a box with a width and a least height, a share of
 * the room, and where they sit across their parent.
 */
function asSized(node: MailContainer | MailColumns): MailBlock {
	return {
		id: node.id,
		kind: "text",
		tag: "p",
		html: "",
		text: defaultText(),
		box: node.box,
		grow: node.grow,
		alignSelf: node.alignSelf,
		hidden: node.hidden,
		actions: node.actions,
	};
}

/** The part of a sizing patch a container or a columns table has of its own. */
function placementOf(patch: Partial<MailBlock>): { grow?: number; alignSelf?: MailSelfAlign; box?: MailBoxStyle } {
	return {
		...(patch.grow !== undefined ? { grow: patch.grow } : {}),
		...(patch.alignSelf !== undefined ? { alignSelf: patch.alignSelf } : {}),
		...("box" in patch && patch.box ? { box: patch.box } : {}),
	};
}

/** The stretch toggles beside the alignment box, by the axis they stretch along. */
const STRETCH: Record<PageAxis, { label: string; icon: IconName }> = {
	horizontal: { label: "Stretch across", icon: "self-h-stretch" },
	vertical: { label: "Stretch down", icon: "self-v-stretch" },
};

/** What each text tag and heading level is called in the Element list. */
function textOptions(): { value: string; label: string }[] {
	return groupInfo("text").elements.map((element) => ({ value: element.id, label: `${element.label} (${element.tag})` }));
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

type AcrossRowsProps = {
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
function AcrossRows({ axis, value, onChange }: AcrossRowsProps) {
	return (
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
	);
}

const NO_AUTO: AutoSides = { left: false, right: false };

type SpacingFieldsProps = {
	kind: "Padding" | "Margin";
	value: MailSpacing;
	onChange: (value: MailSpacing) => void;
	/** Sides the element's own alignment keeps in `auto`: shown as Auto, and not typed into. */
	auto?: AutoSides;
};

/**
 * Figma's padding, and margin the same way: across and down as two numbers, or
 * each side on its own behind the button beside them. Sides that differ open
 * on their own, and so do sides of which only one is Auto.
 */
function SpacingFields({ kind, value, onChange, auto = NO_AUTO }: SpacingFieldsProps) {
	const even = value.left === value.right && value.top === value.bottom;
	const [split, setSplit] = useState(!even);
	const apart = split || !even || auto.left !== auto.right;
	const lower = kind.toLowerCase();
	const field = (side: keyof MailSpacing, prefix: string, label: string, isAuto = false) => (
		<NumberInput
			key={side}
			label={label}
			prefix={prefix}
			value={isAuto ? null : value[side]}
			unset={isAuto ? { label: "Auto", onClear: () => undefined } : undefined}
			disabled={isAuto}
			min={0}
			max={200}
			onChange={(next) => onChange({ ...value, [side]: next })}
		/>
	);
	return (
		<div className="flex items-start gap-0.5">
			<div className="min-w-0 flex-1">
				{apart ? (
					<PanelPair>
						{field("top", "T", `${kind} top`)}
						{field("right", "R", `${kind} right`, auto.right)}
						{field("bottom", "B", `${kind} bottom`)}
						{field("left", "L", `${kind} left`, auto.left)}
					</PanelPair>
				) : (
					<PanelPair>
						{auto.left && auto.right ? (
							field("left", "↔", `${kind} left and right`, true)
						) : (
							<NumberInput
								label={`${kind} left and right`}
								prefix="↔"
								value={value.left}
								min={0}
								max={200}
								onChange={(next) => onChange({ ...value, left: next, right: next })}
							/>
						)}
						<NumberInput
							label={`${kind} top and bottom`}
							prefix="↕"
							value={value.top}
							min={0}
							max={200}
							onChange={(next) => onChange({ ...value, top: next, bottom: next })}
						/>
					</PanelPair>
				)}
			</div>
			<PanelButton
				label={apart ? `The same ${lower} on opposite sides` : `${kind} for each side`}
				icon="corners"
				active={apart}
				onClick={() => {
					if (apart && !even) onChange({ ...value, right: value.left, bottom: value.top });
					setSplit(!apart);
				}}
			/>
		</div>
	);
}

/** A corner radius and where it is kept: a box's own, or a button's. */
type Radius = { value: number; onChange: (value: number) => void };

type SizeFieldsProps = {
	/** The block, or a container or columns table read as one (asSized). */
	node: MailBlock;
	placer: Placer;
	measured: Measured | null;
	onPatch: (patch: Partial<MailBlock>) => void;
	/** A columns table has no height of its own: a least height on a table is ignored by mail clients. */
	height?: boolean;
};

/**
 * Figma's W and H, each with whether it is fixed, hugs or fills, worked out
 * by sizing.ts for the parent the node sits in; then its share of the room,
 * when it has one.
 *
 * W and H always say how big the node is drawn, so one that fills shows the
 * width it fills to, and typing a number fixes that side at it. A fixed width
 * still gives way on a narrow screen, and a height is the least the node will
 * be: content longer than it makes the node taller.
 */
function SizeFields({ node, placer, measured, onPatch, height = true }: SizeFieldsProps) {
	const across = widthModes(node, placer);
	const down = heightModes(node, placer);
	const width = fixedWidth(node) ?? (measured ? Math.round(measured.width) : null);
	const tall = fixedHeight(node) ?? (measured ? Math.round(measured.height) : null);
	const heightMode = heightSizing(node, placer);

	return (
		<>
			<PanelPair>
				<DimensionInput
					prefix="W"
					label="Width"
					value={width}
					editable={across.includes("fixed")}
					onValue={(next) => onPatch(setWidth(node, placer, next))}
					mode={widthSizing(node, placer)}
					modes={across}
					onMode={(mode) => onPatch(sizeWidth(node, placer, mode, measured?.width ?? null))}
					max={1600}
				/>
				{height ? (
					<DimensionInput
						prefix="H"
						label="Height"
						value={tall}
						editable={down.includes("fixed")}
						onValue={(next) => onPatch(setHeight(node, placer, next))}
						mode={heightMode}
						modes={down}
						onMode={(mode) => onPatch(sizeHeight(node, placer, mode, measured?.height ?? null))}
						min={1}
						max={4000}
					/>
				) : (
					<span />
				)}
			</PanelPair>

			{node.grow > 0 ? (
				<NumberInput
					label="Share of the room left"
					prefix="x"
					value={node.grow}
					min={1}
					max={12}
					onChange={(next) => onPatch({ grow: next })}
				/>
			) : null}

			{height && heightMode === "fixed" && node.kind !== "spacer" ? (
				<PanelNote>The least it will be. Anything longer makes it taller.</PanelNote>
			) : null}
		</>
	);
}

type TextLayoutSectionProps = {
	text: MailTextStyle;
	onText: (patch: Partial<MailTextStyle>) => void;
	/** Only a text block or a heading can sit lower in a taller box; a list, a button and an input cannot. */
	vertical: boolean;
};

/**
 * What a text lays out is words, not children, so its Layout is how they sit:
 * across their line and, where the box is taller than they are, down it.
 */
function TextLayoutSection({ text, onText, vertical }: TextLayoutSectionProps) {
	return (
		<PanelSection title="Layout">
			<Segmented
				label="Horizontal alignment"
				value={text.align}
				options={[
					{ value: "left", label: "Left", icon: "align-left", title: "Align left" },
					{ value: "center", label: "Centre", icon: "align-center", title: "Align centre" },
					{ value: "right", label: "Right", icon: "align-right", title: "Align right" },
					{ value: "justify", label: "Justify", icon: "align-justify", title: "Justify" },
				]}
				onChange={(align) => onText({ align })}
			/>
			{vertical ? (
				<Segmented
					label="Vertical alignment"
					value={text.verticalAlign}
					options={[
						{ value: "top", label: "Top", icon: "text-top", title: "Text at the top" },
						{ value: "middle", label: "Middle", icon: "text-middle", title: "Text in the middle" },
						{ value: "bottom", label: "Bottom", icon: "text-bottom", title: "Text at the bottom" },
					]}
					onChange={(verticalAlign) => onText({ verticalAlign })}
				/>
			) : null}
		</PanelSection>
	);
}

type SpacingSectionProps = {
	padding: { value: MailSpacing; onChange: (value: MailSpacing) => void } | null;
	margin: { value: MailSpacing; onChange: (value: MailSpacing) => void; auto: AutoSides } | null;
};

/**
 * Figma's padding, the room inside the box, and the margin Figma leaves out,
 * the room round it. A side of the margin that the element's alignment already
 * sets to auto says so and takes no number.
 */
function SpacingSection({ padding, margin }: SpacingSectionProps) {
	if (!padding && !margin) return null;
	const anyAuto = margin !== null && (margin.auto.left || margin.auto.right);
	return (
		<PanelSection title="Spacing">
			{padding ? (
				<>
					<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">Padding</span>
					<SpacingFields kind="Padding" value={padding.value} onChange={padding.onChange} />
				</>
			) : null}
			{margin ? (
				<>
					<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">Margin</span>
					<SpacingFields kind="Margin" value={margin.value} onChange={margin.onChange} auto={margin.auto} />
					{anyAuto ? <PanelNote>A side in Auto is set by where it sits, under Position.</PanelNote> : null}
					<PanelNote tone="warn">Outlook on Windows ignores margins on a div in some versions.</PanelNote>
				</>
			) : null}
		</PanelSection>
	);
}

type AppearanceSectionProps = {
	/** Left out for a cell, which is fixed in place by its row and has no eye of its own. */
	hidden?: boolean;
	onHidden?: (hidden: boolean) => void;
	box: MailBoxStyle;
	onBox: BoxPatch;
	showOpacity?: boolean;
	/** The corner radius, when this has corners. */
	radius?: Radius | null;
};

/**
 * Figma's appearance: whether the thing shows, how round its corners are and
 * how see-through it is, the radius and the opacity on one row. The button
 * beside them gives every corner a radius of its own. Blend modes are left
 * out, because no mail client on the list applies one.
 */
function AppearanceSection({ hidden, onHidden, box, onBox, showOpacity = true, radius = null }: AppearanceSectionProps) {
	const corners = box.corners;
	const opacity = showOpacity ? (
		<NumberInput
			label="Opacity"
			prefix="Opacity"
			value={Math.round(box.opacity * 100)}
			min={0}
			max={100}
			onChange={(next) => onBox({ opacity: next / 100 })}
		/>
	) : (
		<span />
	);
	return (
		<PanelSection
			title="Appearance"
			action={
				onHidden ? (
					<PanelButton
						label={hidden ? "Show in the message" : "Hide from the message"}
						icon={hidden ? "hidden" : "visible"}
						active={hidden}
						onClick={() => onHidden(!hidden)}
					/>
				) : null
			}
		>
			{hidden ? <PanelNote>Hidden. It stays in the layers and is left out of the message.</PanelNote> : null}
			{radius || showOpacity ? (
				<div className="flex items-start gap-0.5">
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						{radius && corners ? (
							<>
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
											onChange={(next) => onBox({ corners: { ...corners, [corner]: next } })}
										/>
									))}
								</PanelPair>
								{showOpacity ? (
									<PanelPair>
										{opacity}
										<span />
									</PanelPair>
								) : null}
							</>
						) : (
							<PanelPair>
								{radius ? (
									<NumberInput
										label="Corner radius"
										prefix="Radius"
										value={radius.value}
										min={0}
										max={80}
										onChange={radius.onChange}
									/>
								) : (
									<span />
								)}
								{opacity}
							</PanelPair>
						)}
					</div>
					{radius ? (
						<PanelButton
							label={corners ? "One radius for every corner" : "A radius for each corner"}
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
					<PanelNote>https, mailto or tel. An http link would leak the reader's address, so it renders as words.</PanelNote>
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

type ConvertSectionProps = { onConvert: () => void; what: "block" | "group" };

function ConvertSection({ onConvert, what }: ConvertSectionProps) {
	return (
		<PanelSection title="Code">
			<Button size="dense" onClick={onConvert}>
				Convert to HTML
			</Button>
			<PanelNote>
				{what === "block"
					? "The block becomes its own HTML and CSS, edited as code here, and looks exactly as it does now. The controls above do not come back."
					: "It and everything in it become one block of HTML and CSS, edited as code here, and look exactly as they do now. Its layers and the controls above do not come back."}
			</PanelNote>
		</PanelSection>
	);
}

type ElementSectionProps = {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
};

/**
 * The tag something is written as, changed within its group: a container's
 * among the container tags, a text's among the text tags and heading levels.
 * It is the way a heading's level was changed, for every tag the group has.
 */
function ElementSection({ label, value, options, onChange }: ElementSectionProps) {
	return (
		<PanelSection title="Element">
			<PanelSelect label={label} value={value} options={options} onChange={onChange} />
		</PanelSection>
	);
}

type PlacementRowsProps = {
	node: MailContainer | MailColumns;
	placer: Placer;
	onPatch: (patch: { grow?: number; alignSelf?: MailSelfAlign; box?: MailBoxStyle }) => void;
};

/**
 * Where a container or a columns table sits across what holds it. In a flex or
 * grid parent that is the parent's own cross axis, the way a block sits in
 * it; in the frame or a table cell, which lay things out in plain flow, it is
 * margins, and there is nowhere to move until it is narrower than its parent.
 */
function PlacementRows({ node, placer, onPatch }: PlacementRowsProps) {
	if (placer) {
		const sized = asSized(node);
		return (
			<AcrossRows
				axis={crossAxis(placer)}
				value={acrossOf(sized, placer)}
				onChange={(across) => onPatch(placementOf(alignAcross(sized, placer, across)))}
			/>
		);
	}
	const narrower = node.box.width !== null;
	return (
		<>
			<Segmented
				label="Where it sits across what holds it"
				value={narrower ? (node.alignSelf === "center" || node.alignSelf === "end" ? node.alignSelf : "start") : null}
				options={acrossOptions("h", false)}
				onChange={(alignSelf) => onPatch({ alignSelf })}
				disabled={!narrower}
			/>
			{!narrower ? <PanelNote>Something that fills what holds it has nowhere to move. Give it a fixed width.</PanelNote> : null}
		</>
	);
}

/* ------------------------------------------------------------------- panel */

/**
 * The properties of whatever is selected: the frame, a container, a columns
 * table, one of its cells or a block, in Figma's order. Breakpoints first,
 * because they decide which width every control below is changing; then the
 * element it is written as, and then the same order for every kind: position
 * (where it sits in its parent, and its size), layout (how it arranges what is
 * in it, or for a text how its words sit), spacing (padding and margin),
 * appearance (the eye, radius and opacity), type, fill, stroke and effects,
 * then what only that kind has. A section an element has nothing for is left
 * out.
 *
 * There is no X, no Y and no rotation, because nothing in a message is placed
 * or turned: a node sits where the flex, grid or plain flow of what holds it
 * puts it, and the position row moves it across that and nowhere else. There
 * is no blend mode and no export. A control that a common mail client ignores
 * says so where it is set. A block converted to HTML shows its code and
 * nothing else.
 *
 * What something is written as and what it holds are the same at every width,
 * so changing a tag, a row or a cell goes to the stored canvas (`onBase`)
 * whichever breakpoint is being looked at, and only how something looks goes
 * to the breakpoint.
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
	onColumns,
	onCell,
	onBlock,
	onRemove,
	onConvert,
	onSelect,
}: DesignPanelProps) {
	// A container, a columns table or a block, anywhere in the tree; a cell,
	// which is none of those, separately. Both are found by id alone, so a
	// row selected three levels deep in the layers shows the same panel a
	// click on it in the canvas would.
	const node = selection ? findNode(layout, selection.id) : null;
	const cell = selection && !node ? findCell(layout, selection.id) : null;
	const colors = colorsIn(layout, selection?.id ?? null);
	const recolor = (from: string, to: string) => onReplace(replaceColor(layout, selection?.id ?? null, from, to));
	const breakpoints = <BreakpointsSection layout={base} active={active} onActive={onActive} onLayout={onBase} />;
	const structure = (change: (canvas: MailLayout) => MailLayout) => onBase(change(base));
	// Actions are content: a link or a hover is the same at every width, so they
	// go to the stored canvas like a tag does and never to a breakpoint.
	const actionsFor = (id: string, actions: MailAction[], wholeBox = true) => (
		<ActionsSection
			actions={actions}
			clickBlocked={clickBlockedReason(layout, id)}
			wholeBox={wholeBox}
			onActions={(next) => structure((canvas) => setActions(canvas, id, next))}
		/>
	);

	if (!node && !cell) {
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

	// A cell is fixed in place by its row: it has no eye, no position to move
	// in and no layers row of its own to drag. Its width and alignment are the
	// table's structure and are the same at every width; how it looks is not.
	if (cell) {
		const at = locateCell(base, cell.id);
		const onCellBox: BoxPatch = (patch) => onCell(cell.id, { box: { ...cell.box, ...patch } });
		const removable = at !== null && at.row.cells.length > 1;
		return (
			<div className="flex flex-col">
				{breakpoints}
				<Header
					label="Cell"
					deleteLabel="Remove cell"
					onDelete={
						at && removable
							? () => {
									structure((canvas) => removeCell(canvas, at.columns.id, at.row.id, cell.id));
									onSelect({ id: at.columns.id });
								}
							: undefined
					}
				/>
				<PanelSection title="Position">
					<NumberInput
						label="Width"
						prefix="W"
						suffix="%"
						value={cell.width}
						min={1}
						max={100}
						unset={{ label: "Auto", onClear: () => structure((canvas) => updateCell(canvas, cell.id, { width: null })) }}
						onChange={(width) => structure((canvas) => updateCell(canvas, cell.id, { width: Math.round(width) }))}
					/>
					<PanelNote>A percentage of the table, or empty to share what is left. It is the same at every width.</PanelNote>
				</PanelSection>
				<PanelSection title="Layout">
					<Segmented
						label="Align down"
						value={cell.verticalAlign}
						options={
							[
								{ value: "top", label: "Top", icon: "self-v-start", title: "Align top" },
								{ value: "middle", label: "Middle", icon: "self-v-center", title: "Align middle" },
								{ value: "bottom", label: "Bottom", icon: "self-v-end", title: "Align bottom" },
							] satisfies SegmentedOption<MailVerticalAlign>[]
						}
						onChange={(verticalAlign) => structure((canvas) => updateCell(canvas, cell.id, { verticalAlign }))}
					/>
					<PanelCheckbox label="Clip content" checked={cell.box.clip} onChange={(clip) => onCellBox({ clip })} />
					<PanelNote>The alignment is the same at every width.</PanelNote>
				</PanelSection>
				<SpacingSection
					padding={{ value: cell.box.padding, onChange: (padding) => onCellBox({ padding }) }}
					// A td ignores a margin, so a cell has none.
					margin={null}
				/>
				<AppearanceSection
					box={cell.box}
					onBox={onCellBox}
					radius={{ value: cell.box.borderRadius, onChange: (next) => onCellBox({ borderRadius: next }) }}
				/>
				<FillSection fill={cell.box.fill} onFill={(fill) => onCellBox({ fill })} />
				<StrokeSection box={cell.box} onBox={onCellBox} />
				<EffectsSection box={cell.box} onBox={onCellBox} />
				{actionsFor(cell.id, cell.actions)}
				<SelectionColors colors={colors} onReplace={recolor} />
				<CustomCssSection css={cell.box.customCss} onChange={(customCss) => onCellBox({ customCss })} />
			</div>
		);
	}

	if (node && node.kind === "columns") {
		const columns = node;
		const placer = placerOf(layout, columns.id);
		const onColumnsBox: BoxPatch = (patch) => onColumns(columns.id, { box: { ...columns.box, ...patch } });
		return (
			<div className="flex flex-col">
				{breakpoints}
				<Header
					label="Columns"
					name={{ value: columns.name, onChange: (name) => onColumns(columns.id, { name }) }}
					deleteLabel="Delete columns"
					onDelete={() => onRemove(columns.id)}
				/>
				<PanelSection title="Position">
					<PlacementRows node={columns} placer={placer} onPatch={(patch) => onColumns(columns.id, patch)} />
					<SizeFields
						node={asSized(columns)}
						placer={placer}
						measured={measured}
						height={false}
						onPatch={(patch) => onColumns(columns.id, placementOf(patch))}
					/>
				</PanelSection>
				<PanelSection title="Layout">
					<NumberInput
						label="Gap between cells"
						prefix="Gap"
						value={columns.gap}
						min={0}
						max={120}
						onChange={(gap) => structure((canvas) => updateColumns(canvas, columns.id, { gap: Math.round(gap) }))}
					/>
					{active ? <PanelNote>The gap is the same at every width.</PanelNote> : null}
					<PanelNote>
						Cells stay side by side in Outlook on Windows. A table's own padding and corners are drawn by fewer clients
						than a cell's.
					</PanelNote>
				</PanelSection>
				<SpacingSection
					padding={{ value: columns.box.padding, onChange: (padding) => onColumnsBox({ padding }) }}
					margin={{
						value: columns.box.margin,
						onChange: (margin) => onColumnsBox({ margin }),
						auto: flowAutoSides(columns, placer === null),
					}}
				/>
				<AppearanceSection
					hidden={columns.hidden}
					onHidden={(hidden) => onColumns(columns.id, { hidden })}
					box={columns.box}
					onBox={onColumnsBox}
					radius={{ value: columns.box.borderRadius, onChange: (next) => onColumnsBox({ borderRadius: next }) }}
				/>
				<FillSection fill={columns.box.fill} onFill={(fill) => onColumnsBox({ fill })} />
				<StrokeSection box={columns.box} onBox={onColumnsBox} />
				<EffectsSection box={columns.box} onBox={onColumnsBox} />
				{actionsFor(columns.id, columns.actions)}
				<PanelSection
					title="Rows"
					action={
						<PanelButton label="Add row" icon="add" onClick={() => structure((canvas) => addRow(canvas, columns.id))} />
					}
				>
					{columns.rows.map((row, index) => (
						<div key={row.id} className="flex h-[28px] items-center gap-1">
							<span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--ink)]">Row {index + 1}</span>
							<span className="tabular flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
								{row.cells.length} {row.cells.length === 1 ? "cell" : "cells"}
							</span>
							<PanelButton
								label={`Remove the last cell of row ${index + 1}`}
								icon="minus"
								disabled={row.cells.length <= 1}
								onClick={() => {
									const lastCell = row.cells[row.cells.length - 1];
									if (lastCell) structure((canvas) => removeCell(canvas, columns.id, row.id, lastCell.id));
								}}
							/>
							<PanelButton
								label={`Add a cell to row ${index + 1}`}
								icon="add"
								onClick={() => structure((canvas) => addCell(canvas, columns.id, row.id))}
							/>
							<PanelButton
								label={`Remove row ${index + 1}`}
								icon="remove"
								tone="danger"
								disabled={columns.rows.length <= 1}
								onClick={() => structure((canvas) => removeRow(canvas, columns.id, row.id))}
							/>
						</div>
					))}
				</PanelSection>
				<SelectionColors colors={colors} onReplace={recolor} />
				<CustomCssSection css={columns.box.customCss} onChange={(customCss) => onColumnsBox({ customCss })} />
				<ConvertSection what="group" onConvert={() => onConvert(columns.id)} />
			</div>
		);
	}

	const block = node && node.kind !== "container" ? node : null;
	// What lays the block out: the container it sits in, at whatever depth, or
	// nothing when it sits in the frame or a table cell, which lay their
	// children out in plain flow. sizing.ts only ever looks at the one parent.
	const blockPlacer = block ? placerOf(layout, block.id) : null;

	if (block) {
		const set = (patch: Partial<MailBlock>) => onBlock(block.id, patch);

		if (block.kind === "html") {
			return (
				<div className="flex flex-col">
					{breakpoints}
					<Header
						label={BLOCK_KIND_LABELS.html}
						deleteLabel="Delete block"
						onDelete={() => onRemove(block.id)}
						hidden={{ value: block.hidden, onChange: (hidden) => set({ hidden } as Partial<MailBlock>) }}
					/>
					<CodeSection block={block} set={set} />
					{actionsFor(block.id, block.actions)}
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
			onReplace(updateBlock(linked, block.id, { text: { ...block.text, fontFamily: family } } as Partial<MailBlock>));
		};
		const radius =
			can.radius === "button" && block.kind === "button"
				? { value: block.radius, onChange: (next: number) => set({ radius: next } as Partial<MailBlock>) }
				: can.radius === "box" && box
					? { value: box.borderRadius, onChange: (next: number) => onBox({ borderRadius: next }) }
					: null;
		const textBlock = block.kind === "text" || block.kind === "heading" ? block : null;
		// A picture in plain flow can still be moved across by its margins; nothing
		// else in plain flow has anywhere to go.
		const positioned = blockPlacer !== null || block.kind === "image";
		// The margin sides a picture's alignment already sets to auto.
		const marginAuto = block.kind === "image" ? pictureAutoSides(block.align) : NO_AUTO;

		return (
			<div className="flex flex-col">
				{breakpoints}
				<Header
					label={textBlock ? elementInfo(textBlock.tag).element.label : BLOCK_KIND_LABELS[block.kind]}
					deleteLabel="Delete block"
					onDelete={() => onRemove(block.id)}
					// A spacer has no appearance section, so its eye is up here.
					hidden={box ? undefined : { value: block.hidden, onChange: (hidden) => set({ hidden } as Partial<MailBlock>) }}
				/>
				{textBlock ? (
					<ElementSection
						label="Text element"
						value={textBlock.tag}
						options={textOptions()}
						onChange={(tag) => structure((canvas) => setTextTag(canvas, textBlock.id, tag as MailTextTag | MailHeadingTag))}
					/>
				) : null}
				<PanelSection title="Position">
					{positioned ? (
						<AcrossRows
							axis={blockPlacer ? crossAxis(blockPlacer) : "h"}
							value={acrossOf(block, blockPlacer)}
							onChange={(across) => set(alignAcross(block, blockPlacer, across))}
						/>
					) : null}
					<SizeFields node={block} placer={blockPlacer} measured={measured} onPatch={set} />
				</PanelSection>
				{"text" in block ? (
					<TextLayoutSection
						text={block.text}
						onText={onText}
						vertical={textBlock !== null && !(textBlock.kind === "text" && (textBlock.tag === "ul" || textBlock.tag === "ol"))}
					/>
				) : null}
				<SpacingSection
					padding={
						can.padding && box ? { value: box.padding, onChange: (padding) => onBox({ padding }) } : null
					}
					margin={
						can.margin && box
							? { value: box.margin, onChange: (margin) => onBox({ margin }), auto: marginAuto }
							: null
					}
				/>
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
					/>
				) : null}
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
				{actionsFor(block.id, block.actions, block.kind !== "image" && !(block.kind === "text" && block.tag === "span"))}
				<ContentSection block={block} inputs={inputs} set={set} />
				<SelectionColors colors={colors} onReplace={recolor} />
				{box ? <CustomCssSection css={box.customCss} onChange={(customCss) => onBox({ customCss })} /> : null}
				<ConvertSection what="block" onConvert={() => onConvert(block.id)} />
			</div>
		);
	}

	// Only a container is left by this point: the frame, a cell, a columns
	// table and a block each returned their own panel above.
	if (!node || node.kind !== "container") return null;
	const section = node;
	const placer = placerOf(layout, section.id);
	const arrangement = section.layout;
	const onSectionBox: BoxPatch = (patch) => onSection(section.id, { box: { ...section.box, ...patch } });
	const patchLayout = (next: MailSectionLayout) => onSection(section.id, { layout: next });
	const spread = spreadOf(arrangement);
	const label = CONTAINER_TAG_LABELS[section.tag];

	return (
		<div className="flex flex-col">
			{breakpoints}
			<Header
				label={label}
				name={{ value: section.name, onChange: (name) => onSection(section.id, { name }) }}
				deleteLabel={`Delete ${label.toLowerCase()}`}
				onDelete={() => onRemove(section.id)}
			/>

			<ElementSection
				label="Container element"
				value={section.tag}
				options={(Object.keys(CONTAINER_TAG_LABELS) as MailContainerTag[]).map((tag) => ({
					value: tag,
					label: CONTAINER_TAG_LABELS[tag],
				}))}
				onChange={(tag) => structure((canvas) => setContainerTag(canvas, section.id, tag as MailContainerTag))}
			/>

			{/* In the frame or a cell a container fills the width or has its own, and
			    hugs what is in it or has a height; in a flex or grid parent it is
			    sized the way a block is. An empty one with a height is a divider or
			    a gap. */}
			<PanelSection title="Position">
				<PlacementRows node={section} placer={placer} onPatch={(patch) => onSection(section.id, patch)} />
				<SizeFields
					node={asSized(section)}
					placer={placer}
					measured={measured}
					onPatch={(patch) => onSection(section.id, placementOf(patch))}
				/>
			</PanelSection>

			<PanelSection
				title="Layout"
				action={
					arrangement.kind === "flex" ? (
						<PanelButton
							label={arrangement.wrap ? "Stop wrapping onto the next line" : "Wrap onto the next line"}
							icon="wrap"
							active={arrangement.wrap}
							onClick={() => patchLayout({ ...arrangement, wrap: !arrangement.wrap })}
						/>
					) : null
				}
			>
				<Segmented
					label="Flow"
					value={flowNameOf(arrangement)}
					options={[
						{ value: "down", label: "Down", icon: "move-down", title: "Down the page" },
						{ value: "across", label: "Across", icon: "move-right", title: "Across the page" },
						{ value: "grid", label: "Grid", icon: "grid", title: "In a grid" },
					]}
					onChange={(next: LayoutFlow) => patchLayout(withFlow(arrangement, next))}
				/>

				<div className="flex items-start gap-2">
					<AlignmentBox
						label="Alignment"
						lit={(column, row) => litAt(arrangement, column, row)}
						onPlace={(column, row) => patchLayout(place(arrangement, column, row))}
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						{stretchAxes(arrangement).map((axis) => (
							<div key={axis} className="flex items-center gap-1">
								<PanelButton
									label={STRETCH[axis].label}
									icon={STRETCH[axis].icon}
									active={isStretched(arrangement, axis)}
									onClick={() => patchLayout(setStretch(arrangement, axis, !isStretched(arrangement, axis)))}
								/>
								<span className="min-w-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">{STRETCH[axis].label}</span>
							</div>
						))}
					</div>
				</div>

				<PanelPair>
					<GapInput
						label="Gap between blocks"
						value={arrangement.gap}
						onValue={(gap) => patchLayout({ ...arrangement, gap })}
						mode={spread ?? "fixed"}
						onMode={
							arrangement.kind === "flex"
								? (mode: GapMode) => patchLayout(setSpread(arrangement, mode === "fixed" ? null : mode))
								: undefined
						}
					/>
					{arrangement.kind === "grid" ? (
						<NumberInput
							label="Columns"
							prefix="Col"
							value={arrangement.columns}
							min={1}
							max={6}
							onChange={(next) => patchLayout({ ...arrangement, columns: Math.round(next) })}
						/>
					) : (
						<span />
					)}
				</PanelPair>
				{spread ? (
					<PanelNote>
						{spread === "between"
							? "The blocks are spread apart, with the same space between each."
							: "The blocks are spread out, with the same space around each."}{" "}
						The gap is the least space between them.
					</PanelNote>
				) : null}

				<PanelCheckbox label="Clip content" checked={section.box.clip} onChange={(clip) => onSectionBox({ clip })} />

				<PanelNote tone="warn">
					Outlook on Windows stacks this container into one column and drops the gap and the alignment.
				</PanelNote>
			</PanelSection>

			<SpacingSection
				padding={{ value: section.box.padding, onChange: (padding) => onSectionBox({ padding }) }}
				margin={{
					value: section.box.margin,
					onChange: (margin) => onSectionBox({ margin }),
					auto: flowAutoSides(section, placer === null),
				}}
			/>
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
			{actionsFor(section.id, section.actions)}
			<SelectionColors colors={colors} onReplace={recolor} />
			<CustomCssSection css={section.box.customCss} onChange={(customCss) => onSectionBox({ customCss })} />
			<ConvertSection what="group" onConvert={() => onConvert(section.id)} />
		</div>
	);
}
