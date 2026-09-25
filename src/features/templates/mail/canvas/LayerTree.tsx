import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { MailBlock, MailLayout } from "@shared/types";
import { Icon, type IconName } from "../../../../components/Icon";
import { BLOCK_KIND_LABELS } from "./canvas-actions";
import type { DropTarget, Selection } from "./CanvasView";

type LayerTarget = { sectionId: string; blockId?: string };

type LayerTreeProps = {
	layout: MailLayout;
	selection: Selection;
	onSelect: (selection: Selection) => void;
	/** Figma's eye: a hidden layer stays here and is left out of the message. */
	onHidden: (target: LayerTarget, hidden: boolean) => void;
	/** A block let go on a block's row (in front of it) or a section's row (at its end). */
	onDropBlock: (fromSectionId: string, blockId: string, target: DropTarget) => void;
	/** A section let go on another section's row, in front of it, or at the end. */
	onDropSection: (sectionId: string, beforeSectionId: string | null) => void;
	/** Alt with an arrow on a focused row: one place up or down. */
	onStep: (target: LayerTarget, by: -1 | 1) => void;
};

/** The same keys the canvas drags a block with, so a block can go from one to the other. */
const BLOCK_SECTION = "application/x-juno-section";
const BLOCK_ID = "application/x-juno-block";
const SECTION = "application/x-juno-layer-section";

const BLOCK_ICONS: Record<MailBlock["kind"], IconName> = {
	text: "tool-text",
	heading: "tool-heading",
	button: "tool-button",
	image: "image",
	field: "tool-input",
	divider: "tool-divider",
	spacer: "tool-spacer",
	html: "view-code",
};

/** What a block is called in the tree: what it says, or what it is. */
function blockLabel(block: MailBlock): string {
	switch (block.kind) {
		case "heading":
			return block.content || BLOCK_KIND_LABELS.heading;
		case "text":
			return block.html.replace(/<[^>]+>/g, "").trim() || BLOCK_KIND_LABELS.text;
		case "html":
			return block.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || BLOCK_KIND_LABELS.html;
		case "button":
			return block.label || BLOCK_KIND_LABELS.button;
		case "image":
			return block.alt || BLOCK_KIND_LABELS.image;
		case "field":
			return block.inputKey || BLOCK_KIND_LABELS.field;
		default:
			return BLOCK_KIND_LABELS[block.kind];
	}
}

type EyeProps = {
	name: string;
	hidden: boolean;
	onToggle: () => void;
};

/**
 * The eye at the end of a row. Always there on a hidden layer, so a row that
 * is missing from the canvas says why, and there on hover or focus otherwise.
 */
function Eye({ name, hidden, onToggle }: EyeProps) {
	return (
		<button
			type="button"
			aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
			title={hidden ? "Show in the message" : "Hide from the message"}
			aria-pressed={hidden}
			onClick={(event) => {
				event.stopPropagation();
				onToggle();
			}}
			className={`flex h-[28px] w-[28px] flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
				hidden ? "opacity-100" : "opacity-0 group-hover:opacity-100"
			}`}
		>
			<Icon name={hidden ? "hidden" : "visible"} size={13} />
		</button>
	);
}

/** Where something being dragged would land, drawn as a line over that row. */
type Over = { kind: "block"; sectionId: string; blockId: string } | { kind: "section"; sectionId: string | null };

/**
 * The layers: every section, and the blocks inside the ones that are open.
 *
 * It is the same selection the canvas has, so clicking a row here points the
 * design panel at the same thing clicking the block does. A hidden layer is
 * not drawn on the canvas, so this is also the only place to select one, and
 * its row stays dimmed until it is shown again.
 *
 * Order is changed here, the way it is in Figma: a block dragged onto another
 * block lands in front of it, onto a section lands at the end of it, and a
 * section dragged onto another section lands in front of that one. Alt and an
 * arrow move the focused layer one place, for a keyboard.
 */
export function LayerTree({ layout, selection, onSelect, onHidden, onDropBlock, onDropSection, onStep }: LayerTreeProps) {
	const [closed, setClosed] = useState<string[]>([]);
	const [over, setOver] = useState<Over | null>(null);

	const step = (event: KeyboardEvent, target: LayerTarget) => {
		if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
		event.preventDefault();
		onStep(target, event.key === "ArrowUp" ? -1 : 1);
	};

	const dropOnSection = (event: DragEvent, sectionId: string | null) => {
		event.preventDefault();
		setOver(null);
		const movingSection = event.dataTransfer.getData(SECTION);
		if (movingSection) {
			onDropSection(movingSection, sectionId);
			return;
		}
		const from = event.dataTransfer.getData(BLOCK_SECTION);
		const blockId = event.dataTransfer.getData(BLOCK_ID);
		if (from && blockId && sectionId) onDropBlock(from, blockId, { sectionId, beforeBlockId: null });
	};

	const line = "shadow-[inset_0_2px_0_0_var(--accent)]";

	return (
		<ul data-layers className="flex flex-col" onDragLeave={() => setOver(null)}>
			{layout.sections.map((section) => {
				const open = !closed.includes(section.id);
				const sectionSelected = selection?.sectionId === section.id && !selection.blockId;
				const sectionOver = over?.kind === "section" && over.sectionId === section.id;
				return (
					<li key={section.id}>
						<div
							draggable
							onDragStart={(event) => {
								event.dataTransfer.setData(SECTION, section.id);
								event.dataTransfer.effectAllowed = "move";
							}}
							onDragOver={(event) => {
								event.preventDefault();
								setOver({ kind: "section", sectionId: section.id });
							}}
							onDrop={(event) => dropOnSection(event, section.id)}
							onDragEnd={() => setOver(null)}
							className={`group flex items-center rounded-[var(--radius-sm)] ${
								sectionSelected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
							} ${section.hidden ? "opacity-60" : ""} ${sectionOver ? line : ""}`}
						>
							<button
								type="button"
								aria-label={open ? `Collapse ${section.name}` : `Expand ${section.name}`}
								aria-expanded={open}
								onClick={() =>
									setClosed((current) =>
										current.includes(section.id)
											? current.filter((id) => id !== section.id)
											: [...current, section.id],
									)
								}
								className="flex h-[28px] w-[20px] flex-none items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)]"
							>
								<Icon name={open ? "chevron-down" : "chevron-right"} size={11} className="flex-none" />
							</button>
							<button
								type="button"
								aria-current={sectionSelected ? "true" : undefined}
								title="Drag to reorder. Alt and an arrow move it too"
								onClick={() => onSelect({ sectionId: section.id })}
								onKeyDown={(event) => step(event, { sectionId: section.id })}
								className={`flex h-[28px] min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[length:var(--text-sm)] font-[var(--weight-medium)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
									sectionSelected ? "text-[var(--accent)]" : "text-[var(--ink)]"
								}`}
							>
								<Icon name="tool-section" size={12} className="flex-none" />
								<span className="truncate">{section.name}</span>
								<span className="tabular ml-auto flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
									{section.blocks.length}
								</span>
							</button>
							<Eye
								name={section.name}
								hidden={section.hidden}
								onToggle={() => onHidden({ sectionId: section.id }, !section.hidden)}
							/>
						</div>

						{open ? (
							<ul className="flex flex-col">
								{section.blocks.map((block) => {
									const blockSelected = selection?.blockId === block.id;
									const label = blockLabel(block);
									const blockOver = over?.kind === "block" && over.blockId === block.id;
									return (
										<li
											key={block.id}
											draggable
											onDragStart={(event) => {
												event.stopPropagation();
												event.dataTransfer.setData(BLOCK_SECTION, section.id);
												event.dataTransfer.setData(BLOCK_ID, block.id);
												event.dataTransfer.effectAllowed = "move";
											}}
											onDragOver={(event) => {
												// A section cannot go inside another section.
												if (event.dataTransfer.types.includes(SECTION)) return;
												event.preventDefault();
												event.stopPropagation();
												setOver({ kind: "block", sectionId: section.id, blockId: block.id });
											}}
											onDrop={(event) => {
												event.preventDefault();
												event.stopPropagation();
												setOver(null);
												const from = event.dataTransfer.getData(BLOCK_SECTION);
												const blockId = event.dataTransfer.getData(BLOCK_ID);
												if (from && blockId) {
													onDropBlock(from, blockId, { sectionId: section.id, beforeBlockId: block.id });
												}
											}}
											onDragEnd={() => setOver(null)}
											className={`group flex items-center rounded-[var(--radius-sm)] ${
												blockSelected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
											} ${block.hidden || section.hidden ? "opacity-60" : ""} ${blockOver ? line : ""}`}
										>
											<button
												type="button"
												aria-current={blockSelected ? "true" : undefined}
												title="Drag to reorder. Alt and an arrow move it too"
												onClick={() => onSelect({ sectionId: section.id, blockId: block.id })}
												onKeyDown={(event) => step(event, { sectionId: section.id, blockId: block.id })}
												className={`flex h-[28px] min-w-0 flex-1 items-center gap-1.5 pr-1 pl-6 text-left text-[length:var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
													blockSelected ? "text-[var(--accent)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
												}`}
											>
												<Icon name={BLOCK_ICONS[block.kind]} size={12} className="flex-none" />
												<span className="truncate">{label}</span>
											</button>
											<Eye
												name={label}
												hidden={block.hidden}
												onToggle={() => onHidden({ sectionId: section.id, blockId: block.id }, !block.hidden)}
											/>
										</li>
									);
								})}
							</ul>
						) : null}
					</li>
				);
			})}
			<li
				aria-hidden
				onDragOver={(event) => {
					if (!event.dataTransfer.types.includes(SECTION)) return;
					event.preventDefault();
					setOver({ kind: "section", sectionId: null });
				}}
				onDrop={(event) => dropOnSection(event, null)}
				className={`h-[16px] rounded-[var(--radius-sm)] ${over?.kind === "section" && over.sectionId === null ? line : ""}`}
			/>
		</ul>
	);
}
