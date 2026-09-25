import type { MailBlock, MailBoxStyle, MailLayout, MailSection, MailTextStyle, TemplateInput } from "@shared/types";
import { Button } from "../../../../components/Button";
import { Field } from "../../../../components/Field";
import { Icon } from "../../../../components/Icon";
import { Select } from "../../../../components/Select";
import { BLOCK_KIND_LABELS } from "./canvas-actions";
import type { Selection } from "./CanvasView";

type InspectorProps = {
	layout: MailLayout;
	inputs: TemplateInput[];
	selection: Selection;
	onLayout: (patch: Partial<Omit<MailLayout, "sections" | "version">>) => void;
	onSection: (sectionId: string, patch: Partial<Omit<MailSection, "id" | "blocks">>) => void;
	onBlock: (sectionId: string, blockId: string, patch: Partial<MailBlock>) => void;
	onRemoveSection: (sectionId: string) => void;
	onMoveSection: (sectionId: string, by: -1 | 1) => void;
	onRemoveBlock: (sectionId: string, blockId: string) => void;
	onMoveBlock: (sectionId: string, blockId: string, by: -1 | 1) => void;
};

/** A colour control that also allows "none", because most of these are unset. */
function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	return (
		<div>
			<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">{label}</span>
			<div className="flex items-center gap-2">
				<input
					type="color"
					value={value ?? "#ffffff"}
					onChange={(event) => onChange(event.target.value)}
					aria-label={label}
					className="h-[32px] w-[40px] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--sunken)]"
				/>
				<span className="flex-1 font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)] tabular-nums">
					{value ?? "not set"}
				</span>
				{value ? (
					<Button size="dense" onClick={() => onChange(null)}>
						Clear
					</Button>
				) : null}
			</div>
		</div>
	);
}

function NumberField({
	label,
	value,
	onChange,
	help,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
	help?: string;
}) {
	return (
		<Field
			label={label}
			type="number"
			tabular
			value={String(value)}
			help={help ?? null}
			onChange={(next) => {
				const parsed = Number.parseFloat(next);
				if (Number.isFinite(parsed)) onChange(parsed);
			}}
		/>
	);
}

function PaddingFields({ box, onBox }: { box: MailBoxStyle; onBox: (patch: Partial<MailBoxStyle>) => void }) {
	const sides = [
		["top", "Top"],
		["right", "Right"],
		["bottom", "Bottom"],
		["left", "Left"],
	] as const;
	return (
		<div className="grid grid-cols-4 gap-2">
			{sides.map(([side, label]) => (
				<NumberField
					key={side}
					label={label}
					value={box.padding[side]}
					onChange={(next) => onBox({ padding: { ...box.padding, [side]: next } })}
				/>
			))}
		</div>
	);
}

function BoxFields({ box, onBox }: { box: MailBoxStyle; onBox: (patch: Partial<MailBoxStyle>) => void }) {
	return (
		<>
			<ColorField label="Background" value={box.background} onChange={(next) => onBox({ background: next })} />
			<PaddingFields box={box} onBox={onBox} />
			<div className="grid grid-cols-2 gap-2">
				<NumberField label="Border" value={box.borderWidth} onChange={(next) => onBox({ borderWidth: next })} />
				<NumberField label="Radius" value={box.borderRadius} onChange={(next) => onBox({ borderRadius: next })} />
			</div>
			{box.borderWidth > 0 ? (
				<ColorField label="Border colour" value={box.borderColor} onChange={(next) => onBox({ borderColor: next })} />
			) : null}
			<Field
				label="Custom CSS"
				multiline
				rows={2}
				value={box.customCss ?? ""}
				onChange={(next) => onBox({ customCss: next || null })}
				placeholder="text-transform:uppercase"
				help="Declarations only. Anything that positions is dropped."
			/>
		</>
	);
}

function TextFields({ text, onText }: { text: MailTextStyle; onText: (patch: Partial<MailTextStyle>) => void }) {
	return (
		<>
			<ColorField label="Colour" value={text.color} onChange={(next) => onText({ color: next })} />
			<div className="grid grid-cols-2 gap-2">
				<Field
					label="Size"
					type="number"
					tabular
					value={text.fontSize === null ? "" : String(text.fontSize)}
					onChange={(next) => onText({ fontSize: next ? Number.parseFloat(next) : null })}
					placeholder="inherit"
				/>
				<Field
					label="Line height"
					type="number"
					tabular
					value={text.lineHeight === null ? "" : String(text.lineHeight)}
					onChange={(next) => onText({ lineHeight: next ? Number.parseFloat(next) : null })}
					placeholder="inherit"
				/>
			</div>
			<Select
				label="Weight"
				value={text.weight}
				onChange={(next) => onText({ weight: next as MailTextStyle["weight"] })}
				options={[
					{ value: "normal", label: "Normal" },
					{ value: "medium", label: "Medium" },
					{ value: "semibold", label: "Semibold" },
					{ value: "bold", label: "Bold" },
				]}
			/>
			<Select
				label="Align"
				value={text.align}
				onChange={(next) => onText({ align: next as MailTextStyle["align"] })}
				options={[
					{ value: "left", label: "Left" },
					{ value: "center", label: "Center" },
					{ value: "right", label: "Right" },
					{ value: "justify", label: "Justify" },
				]}
			/>
		</>
	);
}

/**
 * The properties of whatever is selected: the canvas, a section, or a block.
 *
 * There is no position control anywhere in here, and that is the model rather
 * than an omission. A block is placed by the rules of the section holding it,
 * so what this offers for a section is how it arranges things, and what it
 * offers for a block is how much room that block takes of what the section
 * gives it.
 */
export function Inspector({
	layout,
	inputs,
	selection,
	onLayout,
	onSection,
	onBlock,
	onRemoveSection,
	onMoveSection,
	onRemoveBlock,
	onMoveBlock,
}: InspectorProps) {
	const section = selection ? layout.sections.find((entry) => entry.id === selection.sectionId) ?? null : null;
	const block = section && selection?.blockId
		? section.blocks.find((entry) => entry.id === selection.blockId) ?? null
		: null;

	if (!section) {
		return (
			<div className="flex flex-col gap-4 p-4">
				<h3 className="text-[length:var(--text-sm)] font-[var(--weight-semibold)] text-[var(--ink-muted)]">
					Canvas
				</h3>
				<NumberField
					label="Width"
					value={layout.width}
					onChange={(next) => onLayout({ width: next })}
					help="600 is what mail clients agree on."
				/>
				<NumberField
					label="Height"
					value={layout.minHeight}
					onChange={(next) => onLayout({ minHeight: next })}
					help="The canvas you draw on. Content past it makes the message longer."
				/>
				<ColorField label="Background" value={layout.background} onChange={(next) => onLayout({ background: next })} />
				<Field
					label="Custom CSS"
					multiline
					rows={3}
					value={layout.customCss ?? ""}
					onChange={(next) => onLayout({ customCss: next || null })}
					help="Declarations only. Anything that positions is dropped."
				/>
			</div>
		);
	}

	if (block) {
		const onBox = (patch: Partial<MailBoxStyle>) =>
			"box" in block ? onBlock(section.id, block.id, { box: { ...block.box, ...patch } } as Partial<MailBlock>) : undefined;
		const onText = (patch: Partial<MailTextStyle>) =>
			"text" in block ? onBlock(section.id, block.id, { text: { ...block.text, ...patch } } as Partial<MailBlock>) : undefined;

		return (
			<div className="flex flex-col gap-4 p-4">
				<div className="flex items-center gap-2">
					<h3 className="flex-1 text-[length:var(--text-sm)] font-[var(--weight-semibold)] text-[var(--ink-muted)]">
						{BLOCK_KIND_LABELS[block.kind]}
					</h3>
					<button
						type="button"
						aria-label="Move up"
						title="Move up"
						onClick={() => onMoveBlock(section.id, block.id, -1)}
						className="flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<Icon name="move-up" size={14} />
					</button>
					<button
						type="button"
						aria-label="Move down"
						title="Move down"
						onClick={() => onMoveBlock(section.id, block.id, 1)}
						className="flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<Icon name="move-down" size={14} />
					</button>
					<Button size="dense" variant="danger" onClick={() => onRemoveBlock(section.id, block.id)}>
						Delete
					</Button>
				</div>

				{block.kind === "heading" ? (
					<>
						<Field
							label="Text"
							value={block.content}
							onChange={(next) => onBlock(section.id, block.id, { content: next } as Partial<MailBlock>)}
						/>
						<Select
							label="Level"
							value={String(block.level)}
							onChange={(next) =>
								onBlock(section.id, block.id, { level: Number.parseInt(next, 10) as 1 | 2 | 3 } as Partial<MailBlock>)
							}
							options={[
								{ value: "1", label: "Heading 1" },
								{ value: "2", label: "Heading 2" },
								{ value: "3", label: "Heading 3" },
							]}
						/>
					</>
				) : null}

				{block.kind === "text" ? (
					<Field
						label="Text"
						multiline
						rows={5}
						value={block.html}
						onChange={(next) => onBlock(section.id, block.id, { html: next } as Partial<MailBlock>)}
						help="strong, em, u, s, a, span and br are kept. Placeholders work here."
					/>
				) : null}

				{block.kind === "button" ? (
					<>
						<Field
							label="Label"
							value={block.label}
							onChange={(next) => onBlock(section.id, block.id, { label: next } as Partial<MailBlock>)}
						/>
						<Field
							label="Link"
							type="url"
							value={block.href}
							onChange={(next) => onBlock(section.id, block.id, { href: next } as Partial<MailBlock>)}
							help="https or mailto. A plain http link leaks the reader's address, so it is refused."
						/>
						<ColorField
							label="Background"
							value={block.background}
							onChange={(next) => onBlock(section.id, block.id, { background: next ?? "#4a3fa0" } as Partial<MailBlock>)}
						/>
						<ColorField
							label="Label colour"
							value={block.color}
							onChange={(next) => onBlock(section.id, block.id, { color: next ?? "#ffffff" } as Partial<MailBlock>)}
						/>
						<NumberField
							label="Radius"
							value={block.radius}
							onChange={(next) => onBlock(section.id, block.id, { radius: next } as Partial<MailBlock>)}
						/>
					</>
				) : null}

				{block.kind === "image" ? (
					<>
						<Field
							label="Address"
							type="url"
							value={block.src}
							onChange={(next) => onBlock(section.id, block.id, { src: next } as Partial<MailBlock>)}
							help="https only. A hosted picture beats one carried in the message."
						/>
						<Field
							label="Alt text"
							value={block.alt}
							onChange={(next) => onBlock(section.id, block.id, { alt: next } as Partial<MailBlock>)}
							help="What a reader sees when images are off, which is most of them."
						/>
						<Field
							label="Width"
							type="number"
							tabular
							value={block.width === null ? "" : String(block.width)}
							onChange={(next) =>
								onBlock(section.id, block.id, { width: next ? Number.parseFloat(next) : null } as Partial<MailBlock>)
							}
							placeholder="its own width"
						/>
					</>
				) : null}

				{block.kind === "field" ? (
					<Select
						label="Input"
						value={block.inputKey}
						onChange={(next) => onBlock(section.id, block.id, { inputKey: next } as Partial<MailBlock>)}
						placeholder="Choose an input"
						options={inputs.map((input) => ({
							value: input.key,
							label: `${input.label || input.key} (${input.kind})`,
						}))}
						help={
							inputs.length === 0
								? "This template asks for nothing yet. Declare an input below the canvas first."
								: "An image input renders as a picture, everything else as its value."
						}
					/>
				) : null}

				{block.kind === "divider" ? (
					<>
						<ColorField
							label="Colour"
							value={block.color}
							onChange={(next) => onBlock(section.id, block.id, { color: next ?? "#e3e2ec" } as Partial<MailBlock>)}
						/>
						<NumberField
							label="Thickness"
							value={block.thickness}
							onChange={(next) => onBlock(section.id, block.id, { thickness: next } as Partial<MailBlock>)}
						/>
					</>
				) : null}

				{block.kind === "spacer" ? (
					<NumberField
						label="Height"
						value={block.height}
						onChange={(next) => onBlock(section.id, block.id, { height: next } as Partial<MailBlock>)}
					/>
				) : null}

				{block.kind === "html" ? (
					<Field
						label="HTML"
						multiline
						rows={6}
						value={block.html}
						onChange={(next) => onBlock(section.id, block.id, { html: next } as Partial<MailBlock>)}
						help="Kept as written, minus anything that runs. This is where the code view puts what it could not place."
					/>
				) : null}

				<NumberField
					label="Grow"
					value={block.grow}
					onChange={(next) => onBlock(section.id, block.id, { grow: next } as Partial<MailBlock>)}
					help="0 takes the content's width. 1 or more takes a share of what is left."
				/>

				{"text" in block ? (
					<>
						<h4 className="mt-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
							Text
						</h4>
						<TextFields text={block.text} onText={onText} />
					</>
				) : null}

				{"box" in block ? (
					<>
						<h4 className="mt-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
							Box
						</h4>
						<BoxFields box={block.box} onBox={onBox} />
					</>
				) : null}
			</div>
		);
	}

	const sectionLayout = section.layout;
	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex items-center gap-2">
				<h3 className="flex-1 text-[length:var(--text-sm)] font-[var(--weight-semibold)] text-[var(--ink-muted)]">
					Section
				</h3>
				<button
					type="button"
					aria-label="Move section up"
					title="Move section up"
					onClick={() => onMoveSection(section.id, -1)}
					className="flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon name="move-up" size={14} />
				</button>
				<button
					type="button"
					aria-label="Move section down"
					title="Move section down"
					onClick={() => onMoveSection(section.id, 1)}
					className="flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon name="move-down" size={14} />
				</button>
				<Button size="dense" variant="danger" onClick={() => onRemoveSection(section.id)}>
					Delete
				</Button>
			</div>

			<Field label="Name" value={section.name} onChange={(next) => onSection(section.id, { name: next })} />

			<Select
				label="Arrange with"
				value={sectionLayout.kind}
				onChange={(next) =>
					onSection(section.id, {
						layout:
							next === "grid"
								? { kind: "grid", columns: 2, gap: sectionLayout.gap, align: sectionLayout.align }
								: {
										kind: "flex",
										direction: "column",
										justify: "start",
										align: sectionLayout.align,
										gap: sectionLayout.gap,
										wrap: false,
									},
					})
				}
				options={[
					{ value: "flex", label: "Flexbox" },
					{ value: "grid", label: "Grid" },
				]}
			/>

			<p className="border-l-2 border-[var(--warn)] pl-3 text-[length:var(--text-sm)] text-[var(--warn)]">
				Outlook on Windows supports neither flexbox nor grid. It stacks this section into one column
				and drops the gap and the alignment. Everything else renders it as you see it here.
			</p>

			{sectionLayout.kind === "flex" ? (
				<>
					<Select
						label="Direction"
						value={sectionLayout.direction}
						onChange={(next) =>
							onSection(section.id, { layout: { ...sectionLayout, direction: next as "row" | "column" } })
						}
						options={[
							{ value: "column", label: "Down the page" },
							{ value: "row", label: "Across" },
						]}
					/>
					<Select
						label="Distribute"
						value={sectionLayout.justify}
						onChange={(next) =>
							onSection(section.id, {
								layout: { ...sectionLayout, justify: next as typeof sectionLayout.justify },
							})
						}
						options={[
							{ value: "start", label: "Start" },
							{ value: "center", label: "Center" },
							{ value: "end", label: "End" },
							{ value: "between", label: "Space between" },
							{ value: "around", label: "Space around" },
						]}
					/>
					<label className="flex items-center gap-2 text-[length:var(--text-dense)]">
						<input
							type="checkbox"
							checked={sectionLayout.wrap}
							onChange={(event) =>
								onSection(section.id, { layout: { ...sectionLayout, wrap: event.target.checked } })
							}
							className="h-4 w-4 accent-[var(--accent)]"
						/>
						Wrap onto the next line
					</label>
				</>
			) : (
				<NumberField
					label="Columns"
					value={sectionLayout.columns}
					onChange={(next) =>
						onSection(section.id, { layout: { ...sectionLayout, columns: Math.round(next) } })
					}
				/>
			)}

			<Select
				label="Align"
				value={sectionLayout.align}
				onChange={(next) =>
					onSection(section.id, { layout: { ...sectionLayout, align: next as typeof sectionLayout.align } })
				}
				options={[
					{ value: "stretch", label: "Stretch" },
					{ value: "start", label: "Start" },
					{ value: "center", label: "Center" },
					{ value: "end", label: "End" },
				]}
			/>

			<NumberField
				label="Gap"
				value={sectionLayout.gap}
				onChange={(next) => onSection(section.id, { layout: { ...sectionLayout, gap: next } })}
			/>

			<h4 className="mt-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">Box</h4>
			<BoxFields box={section.box} onBox={(patch) => onSection(section.id, { box: { ...section.box, ...patch } })} />
		</div>
	);
}
