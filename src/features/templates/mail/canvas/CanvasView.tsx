import type { CSSProperties } from "react";
import type { MailBlock, MailBoxStyle, MailLayout, MailSection, MailTextStyle, TemplateInput } from "@shared/types";
import { Icon } from "../../../../components/Icon";

/** What the inspector is pointed at. A section on its own, or one block in it. */
export type Selection = { sectionId: string; blockId?: string } | null;

type CanvasViewProps = {
	layout: MailLayout;
	inputs: TemplateInput[];
	selection: Selection;
	onSelect: (selection: Selection) => void;
	/** Drag a block from one section into another. */
	onReparent: (fromSectionId: string, toSectionId: string, blockId: string) => void;
};

const WEIGHTS: Record<MailTextStyle["weight"], number | undefined> = {
	normal: undefined,
	medium: 500,
	semibold: 600,
	bold: 700,
};

/**
 * The declarations the compiler emits, as a React style object.
 *
 * This mirrors electron/main/services/mail-layout.ts rather than calling it,
 * because the renderer cannot import from electron/main (architecture.md
 * section 7). The copy is deliberate and bounded: the canvas is an editing
 * surface, and the preview frame beside it is rendered by the real compiler,
 * so anything that drifts here shows up as a canvas that disagrees with the
 * preview rather than as output nobody checked.
 */
function boxStyle(box: MailBoxStyle): CSSProperties {
	return {
		background: box.background ?? undefined,
		padding: `${box.padding.top}px ${box.padding.right}px ${box.padding.bottom}px ${box.padding.left}px`,
		border: box.borderWidth > 0 ? `${box.borderWidth}px solid ${box.borderColor ?? "#e3e2ec"}` : undefined,
		borderRadius: box.borderRadius > 0 ? box.borderRadius : undefined,
	};
}

function textStyle(text: MailTextStyle): CSSProperties {
	return {
		color: text.color ?? undefined,
		fontSize: text.fontSize ?? undefined,
		lineHeight: text.lineHeight ?? undefined,
		fontWeight: WEIGHTS[text.weight],
		textAlign: text.align,
	};
}

function sectionStyle(section: MailSection): CSSProperties {
	const common = { ...boxStyle(section.box) };
	if (section.layout.kind === "grid") {
		return {
			...common,
			display: "grid",
			gridTemplateColumns: `repeat(${section.layout.columns},1fr)`,
			gap: section.layout.gap,
			alignItems: section.layout.align === "stretch" ? "stretch" : section.layout.align,
		};
	}
	const justify = {
		start: "flex-start",
		center: "center",
		end: "flex-end",
		between: "space-between",
		around: "space-around",
	}[section.layout.justify];
	return {
		...common,
		display: "flex",
		flexDirection: section.layout.direction,
		justifyContent: justify,
		alignItems: section.layout.align === "stretch" ? "stretch" : section.layout.align,
		gap: section.layout.gap,
		flexWrap: section.layout.wrap ? "wrap" : "nowrap",
	};
}

type BlockViewProps = {
	block: MailBlock;
	inputs: TemplateInput[];
};

/** One block as it will look, near enough to lay a message out by. */
function BlockView({ block, inputs }: BlockViewProps) {
	switch (block.kind) {
		case "heading": {
			const Tag = `h${block.level}` as "h1" | "h2" | "h3";
			return (
				<Tag style={{ margin: 0, ...textStyle(block.text), ...boxStyle(block.box) }}>
					{block.content || "Titel"}
				</Tag>
			);
		}
		case "text":
			return (
				<div
					style={{ margin: 0, ...textStyle(block.text), ...boxStyle(block.box) }}
					// The author's own markup, shown the way it will be sent. It is
					// sanitised by the compiler on save and again on render, and this
					// surface is not where a message from anybody else is displayed.
					dangerouslySetInnerHTML={{ __html: block.html || "Tekst" }}
				/>
			);
		case "button":
			return (
				<span
					style={{
						display: "inline-block",
						background: block.background,
						color: block.color,
						borderRadius: block.radius,
						padding: `${block.box.padding.top}px ${block.box.padding.right}px ${block.box.padding.bottom}px ${block.box.padding.left}px`,
					}}
				>
					{block.label || "Knop"}
				</span>
			);
		case "image":
			return block.src ? (
				<img
					src={block.src}
					alt={block.alt}
					style={{ display: "block", maxWidth: "100%", width: block.width ?? undefined, height: "auto" }}
				/>
			) : (
				<span className="flex items-center gap-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
					<Icon name="image" size={14} /> No image address yet
				</span>
			);
		case "divider":
			return <hr style={{ border: 0, borderTop: `${block.thickness}px solid ${block.color}`, width: "100%" }} />;
		case "spacer":
			return (
				<div
					style={{ height: block.height }}
					className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line)]"
				/>
			);
		case "field": {
			const declared = inputs.find((input) => input.key === block.inputKey);
			if (!block.inputKey) {
				return (
					<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">No input chosen</span>
				);
			}
			return (
				<span
					style={textStyle(block.text)}
					className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)]"
				>
					{declared?.kind === "image" ? (
						<span className="inline-flex items-center gap-1">
							<Icon name="image" size={12} /> {declared.label || block.inputKey}
						</span>
					) : (
						`{{document.${block.inputKey}}}`
					)}
				</span>
			);
		}
		case "html":
			return block.html ? (
				<div style={boxStyle(block.box)} dangerouslySetInnerHTML={{ __html: block.html }} />
			) : (
				<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">Empty raw block</span>
			);
	}
}

/**
 * The frame, and what is in it.
 *
 * The width is fixed because a mail body is: 600 pixels is what clients agree
 * on, and it is set on the canvas rather than dragged, so nothing here offers
 * a side handle. The height is the one dimension the author moves, and content
 * past it simply makes the message longer.
 *
 * Nothing on this surface can be dragged to a coordinate. A block is moved
 * within its section or into another one, and where it lands is decided by the
 * section's own flex or grid rules, which is the whole point of the model.
 */
export function CanvasView({ layout, inputs, selection, onSelect, onReparent }: CanvasViewProps) {
	return (
		<div className="flex justify-center overflow-auto bg-[var(--sunken)] p-6">
			<div
				style={{
					width: layout.width,
					minHeight: layout.minHeight,
					background: layout.background ?? "var(--surface)",
				}}
				className="border border-[var(--line)]"
				onClick={() => onSelect(null)}
			>
				{layout.sections.map((section) => {
					const sectionSelected = selection?.sectionId === section.id && !selection.blockId;
					return (
						<div
							key={section.id}
							role="presentation"
							onClick={(event) => {
								event.stopPropagation();
								onSelect({ sectionId: section.id });
							}}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								const from = event.dataTransfer.getData("application/x-juno-section");
								const blockId = event.dataTransfer.getData("application/x-juno-block");
								if (from && blockId) onReparent(from, section.id, blockId);
							}}
							className={`relative outline-offset-[-2px] ${
								sectionSelected ? "outline-2 outline-[var(--accent)]" : "hover:outline-1 hover:outline-[var(--line-strong)]"
							}`}
						>
							{section.blocks.length === 0 ? (
								<p className="px-3 py-6 text-center text-[length:var(--text-micro)] text-[var(--ink-faint)]">
									{section.name} is empty
								</p>
							) : null}
							<div style={sectionStyle(section)}>
								{section.blocks.map((block) => {
									const blockSelected = selection?.blockId === block.id;
									return (
										<div
											key={block.id}
											role="presentation"
											draggable
											onDragStart={(event) => {
												event.dataTransfer.setData("application/x-juno-section", section.id);
												event.dataTransfer.setData("application/x-juno-block", block.id);
											}}
											onClick={(event) => {
												event.stopPropagation();
												onSelect({ sectionId: section.id, blockId: block.id });
											}}
											style={{ flex: block.grow > 0 ? `${block.grow} 1 0%` : undefined, minWidth: 0 }}
											className={`cursor-default outline-offset-[-1px] ${
												blockSelected
													? "outline-2 outline-[var(--accent)]"
													: "hover:outline-1 hover:outline-dashed hover:outline-[var(--accent)]/50"
											}`}
										>
											<BlockView block={block} inputs={inputs} />
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
