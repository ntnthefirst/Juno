import { useState } from "react";
import type { MailBlock, MailLayout, MailSection, TemplateInput } from "@shared/types";
import { Button } from "../../../../components/Button";
import {
	addBlock,
	addSection,
	BLOCK_KIND_LABELS,
	BLOCK_KINDS,
	moveBlock,
	moveSection,
	newBlock,
	removeBlock,
	removeSection,
	reparentBlock,
	updateBlock,
	updateSection,
	type BlockKind,
} from "./canvas-actions";
import { CanvasView, type Selection } from "./CanvasView";
import { Inspector } from "./Inspector";

type CanvasEditorProps = {
	layout: MailLayout;
	inputs: TemplateInput[];
	onChange: (layout: MailLayout) => void;
};

/**
 * The canvas, the thing that inserts into it, and the properties of whatever
 * is selected.
 *
 * A block is always inserted into a section, never onto the canvas, because
 * there is nowhere on the canvas for it to go: the model has no coordinates.
 * With nothing selected the insert buttons add to the last section, which is
 * the one an author is usually working at the bottom of.
 */
export function CanvasEditor({ layout, inputs, onChange }: CanvasEditorProps) {
	const [selection, setSelection] = useState<Selection>(null);

	const targetSectionId =
		selection?.sectionId ?? layout.sections[layout.sections.length - 1]?.id ?? null;

	function insert(kind: BlockKind): void {
		if (!targetSectionId) return;
		const block: MailBlock = newBlock(kind);
		onChange(addBlock(layout, targetSectionId, block));
		setSelection({ sectionId: targetSectionId, blockId: block.id });
	}

	return (
		<div className="flex min-h-[520px] flex-col rounded-b-[var(--radius-lg)] border border-t-0 border-[var(--line)]">
			<div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
				<span className="px-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]">Insert</span>
				{BLOCK_KINDS.map((kind) => (
					<Button key={kind} size="dense" disabled={!targetSectionId} onClick={() => insert(kind)}>
						{BLOCK_KIND_LABELS[kind]}
					</Button>
				))}
				<span className="ml-auto" />
				<Button
					size="dense"
					onClick={() => {
						const next = addSection(layout, selection?.sectionId);
						onChange(next);
						const added = next.sections.find(
							(section) => !layout.sections.some((old) => old.id === section.id),
						);
						if (added) setSelection({ sectionId: added.id });
					}}
				>
					Add section
				</Button>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="w-[140px] flex-none border-r border-[var(--line)] py-2">
					<p className="px-3 pb-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]">Sections</p>
					<ul>
						{layout.sections.map((section: MailSection) => (
							<li key={section.id}>
								<button
									type="button"
									onClick={() => setSelection({ sectionId: section.id })}
									aria-current={selection?.sectionId === section.id ? "true" : undefined}
									style={{ minHeight: "var(--row-height)" }}
									className={`block w-full truncate px-3 text-left text-[length:var(--text-dense)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
										selection?.sectionId === section.id
											? "bg-[var(--accent-soft)] text-[var(--accent)]"
											: "hover:bg-[var(--hover)]"
									}`}
								>
									{section.name}
								</button>
							</li>
						))}
					</ul>
				</div>

				<div className="min-w-0 flex-1">
					<CanvasView
						layout={layout}
						inputs={inputs}
						selection={selection}
						onSelect={setSelection}
						onReparent={(from, to, blockId) => onChange(reparentBlock(layout, from, to, blockId))}
					/>
				</div>

				<div className="w-[280px] flex-none overflow-y-auto border-l border-[var(--line)]">
					<Inspector
						layout={layout}
						inputs={inputs}
						selection={selection}
						onLayout={(patch) => onChange({ ...layout, ...patch })}
						onSection={(sectionId, patch) => onChange(updateSection(layout, sectionId, patch))}
						onBlock={(sectionId, blockId, patch) => onChange(updateBlock(layout, sectionId, blockId, patch))}
						onRemoveSection={(sectionId) => {
							onChange(removeSection(layout, sectionId));
							setSelection(null);
						}}
						onMoveSection={(sectionId, by) => onChange(moveSection(layout, sectionId, by))}
						onRemoveBlock={(sectionId, blockId) => {
							onChange(removeBlock(layout, sectionId, blockId));
							setSelection({ sectionId });
						}}
						onMoveBlock={(sectionId, blockId, by) => onChange(moveBlock(layout, sectionId, blockId, by))}
					/>
				</div>
			</div>
		</div>
	);
}
