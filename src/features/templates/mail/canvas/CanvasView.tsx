import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type HTMLAttributes } from "react";
import type { MailBlock, MailFont, MailLayout, MailSection, TemplateInput } from "@shared/types";
import { Icon } from "../../../../components/Icon";
import {
	boxCss,
	CLIENT_DEFAULTS,
	fillCss,
	MAIL_SHELL,
	placeCss,
	placementFromCss,
	sectionCss,
	textCss,
	verticalCss,
} from "./box-style";
import { codeMarkup } from "./code-markup";
import { InlineText, type Caret } from "./InlineText";

/** What the design panel is pointed at. A section on its own, or one block in it. */
export type Selection = { sectionId: string; blockId?: string } | null;

/** Where a dragged block was let go: in front of a block, or at the end of a section. */
export type DropTarget = { sectionId: string; beforeBlockId: string | null };

/** A text block or a heading being edited in place, and where its caret starts. */
export type Editing = { blockId: string; caret: Caret };

/** How big what is selected is drawn, in the frame's own pixels. */
export type Measured = { width: number; height: number };

type CanvasViewProps = {
	layout: MailLayout;
	inputs: TemplateInput[];
	/** The width the frame is drawn at. A preview choice, not something stored. */
	width: number;
	selection: Selection;
	onSelect: (selection: Selection) => void;
	onDrop: (fromSectionId: string, blockId: string, target: DropTarget) => void;
	/** Text typed on the canvas itself, written back to the block it was typed in. */
	onEdit: (sectionId: string, blockId: string, patch: Partial<MailBlock>) => void;
	/** Held by the editor, so adding a block or pressing Enter can open it too. */
	editing: Editing | null;
	onEditing: (editing: Editing | null) => void;
	/** How tall the content came to, so the height control can refuse to go under it. */
	onContentHeight: (height: number) => void;
	/** The size of what is selected, for the W and H fields. */
	onMeasure: (size: Measured | null) => void;
};

/**
 * What the canvas adds to the element a block is drawn as: its handlers, its
 * marks, and its place in the section.
 */
type Host = {
	id: string;
	attrs: HTMLAttributes<HTMLElement>;
	place: CSSProperties;
	className: string;
};

type BlockViewProps = {
	block: MailBlock;
	inputs: TemplateInput[];
	fonts: MailFont[];
	host: Host;
};

/**
 * One block, drawn as the element the compiler writes for it.
 *
 * That element is the section's flex item in the message, so it is the flex
 * item here too, with the canvas's handlers on it rather than on a box around
 * it. A box around it would be what the section stretches and aligns, and the
 * selection would outline the room the block was given rather than the block:
 * a text block fixed at 100 pixels would be drawn as a line across the frame.
 */
function BlockView({ block, inputs, fonts, host }: BlockViewProps) {
	const own = { ...host.attrs, "data-canvas-id": host.id };
	switch (block.kind) {
		case "heading": {
			const Tag = `h${block.level}` as "h1" | "h2" | "h3";
			return (
				<Tag
					{...own}
					className={host.className}
					style={{
						margin: 0,
						...textCss(block.text, fonts, { alwaysWeight: true }),
						...verticalCss(block.text),
						...boxCss(block.box),
						...host.place,
					}}
				>
					{block.text.verticalAlign === "top" ? (
						block.content || "Titel"
					) : (
						// Matches wrapVertical: pushed down its block, the text is one span.
						<span style={{ display: "block" }}>{block.content || "Titel"}</span>
					)}
				</Tag>
			);
		}
		case "text": {
			const style = {
				margin: 0,
				...textCss(block.text, fonts),
				...verticalCss(block.text),
				...boxCss(block.box),
				...host.place,
			};
			// The author's own markup, shown the way it will be sent. It is
			// sanitised by the compiler on save and again on render, and this
			// surface is not where a message from anybody else is displayed.
			const markup = { __html: block.html || "Tekst" };
			// A paragraph, as the compiler writes it, unless the markup has
			// paragraphs of its own (textTag in services/mail-layout.ts).
			const Tag = /<p[\s>]/i.test(block.html) ? "div" : "p";
			return block.text.verticalAlign === "top" ? (
				<Tag {...own} className={host.className} style={style} dangerouslySetInnerHTML={markup} />
			) : (
				<Tag {...own} className={host.className} style={style}>
					<span style={{ display: "block" }} dangerouslySetInnerHTML={markup} />
				</Tag>
			);
		}
		case "button": {
			const padded = Object.values(block.box.padding).some((side) => side > 0);
			return (
				<span
					{...own}
					className={host.className}
					style={{
						display: "inline-block",
						textDecoration: "none",
						background: block.background,
						color: block.color,
						...textCss(block.text, fonts, { skipColor: true }),
						...boxCss({ ...block.box, fill: null, borderRadius: block.radius }),
						padding: padded
							? `${block.box.padding.top}px ${block.box.padding.right}px ${block.box.padding.bottom}px ${block.box.padding.left}px`
							: "10px 18px",
						...host.place,
					}}
				>
					{block.label || "Knop"}
				</span>
			);
		}
		case "image":
			return block.src ? (
				<img
					{...own}
					src={block.src}
					alt={block.alt}
					className={host.className}
					style={{
						display: "block",
						maxWidth: "100%",
						width: block.width ?? undefined,
						height: "auto",
						marginLeft: block.align === "center" || block.align === "right" ? "auto" : undefined,
						marginRight: block.align === "center" ? "auto" : undefined,
						...boxCss({ ...block.box, width: null }),
						...host.place,
					}}
				/>
			) : (
				<span
					{...own}
					style={host.place}
					className={`flex items-center gap-1.5 text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)] ${host.className}`}
				>
					<Icon name="image" size={14} /> No image address yet
				</span>
			);
		case "divider":
			return (
				<hr
					{...own}
					// A rule is a pixel tall, so the canvas gives it a band above and
					// below to be clicked on. The band is drawn by the canvas and is
					// not in the message.
					className={`relative before:absolute before:inset-x-0 before:-top-2 before:-bottom-2 before:content-[''] ${host.className}`}
					style={{
						border: 0,
						borderTop: `${block.thickness}px solid ${block.color}`,
						width: block.box.width ?? "100%",
						maxWidth: "100%",
						opacity: block.box.opacity < 1 ? block.box.opacity : undefined,
						padding: `${block.box.padding.top}px ${block.box.padding.right}px ${block.box.padding.bottom}px ${block.box.padding.left}px`,
						...host.place,
					}}
				/>
			);
		case "spacer":
			return (
				<div
					{...own}
					// The dashed outline is the canvas's, so the client's defaults leave it alone.
					data-canvas-chrome
					style={{ height: block.height, boxSizing: "border-box", ...host.place }}
					className={`rounded-[var(--radius-sm)] border border-dashed border-[var(--canvas-line)] ${host.className}`}
				/>
			);
		case "field": {
			const declared = inputs.find((input) => input.key === block.inputKey);
			if (!block.inputKey) {
				return (
					<span
						{...own}
						style={host.place}
						className={`text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)] ${host.className}`}
					>
						No input chosen
					</span>
				);
			}
			return (
				<span
					{...own}
					style={{ ...textCss(block.text, fonts), ...boxCss(block.box), ...host.place }}
					className={`rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)] ${host.className}`}
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
			// The author's own code, cleaned the way code-markup.ts says and drawn
			// with its CSS applied by the compiler's rule. The element around it
			// is a column, so the code's root is stretched across it the way the
			// section stretches that root in the message.
			return block.html.trim() ? (
				<div
					{...own}
					className={host.className}
					style={{ display: "flex", flexDirection: "column", ...host.place }}
					dangerouslySetInnerHTML={{ __html: codeMarkup(block.html, block.css) }}
				/>
			) : (
				<span
					{...own}
					style={host.place}
					className={`text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)] ${host.className}`}
				>
					Empty HTML block
				</span>
			);
	}
}

/** The style a text block or heading is edited in, so editing it does not move it. */
function editStyle(block: Extract<MailBlock, { kind: "text" | "heading" }>, fonts: MailFont[]): CSSProperties {
	return {
		margin: 0,
		...textCss(block.text, fonts, { alwaysWeight: block.kind === "heading" }),
		...boxCss(block.box),
	};
}

/** The outline a block is drawn with: selected, a drop landing in front of it, or hovered. */
function blockMarks(selected: boolean, over: boolean): string {
	return `cursor-default outline-offset-[-1px] ${
		selected
			? "outline-2 outline-[var(--accent)]"
			: over
				? "outline-2 outline-dashed outline-[var(--accent)]"
				: "hover:outline-1 hover:outline-dashed hover:outline-[var(--accent)]/50"
	}`;
}

/**
 * The frame, and what is in it.
 *
 * Nothing on this surface can be dragged to a coordinate. A block is dropped
 * in front of another block or at the end of a section, and where it lands is
 * then decided by that section's own flex or grid rules, which is the whole
 * point of the model.
 *
 * A section and a block are each drawn as the element the message carries, so
 * the section's flex or grid lays them out exactly as a mail client will, and
 * the selection outline is the element's own box. A hidden layer is not drawn,
 * which is what Figma does and what the message does: it is still in the
 * layers panel, where it can be selected and shown again. A text block or a
 * heading is edited in place with a double click, with Enter, or straight
 * after it is added.
 *
 * The width comes from the three preview buttons above the frame rather than
 * from the stored layout, so the same canvas can be looked at at phone width
 * without the template changing. The height is stored, because it is the sheet
 * the author draws on, and it never goes under what the content already needs.
 */
export function CanvasView({
	layout,
	inputs,
	width,
	selection,
	onSelect,
	onDrop,
	onEdit,
	editing,
	onEditing,
	onContentHeight,
	onMeasure,
}: CanvasViewProps) {
	const content = useRef<HTMLDivElement>(null);
	const [over, setOver] = useState<DropTarget | null>(null);

	// The content's own height, which the height control reads to refuse
	// anything shorter. Measured rather than calculated: a block's height
	// depends on the text in it and on the width it is being read at.
	useEffect(() => {
		const element = content.current;
		if (!element) return;
		const report = () => onContentHeight(element.getBoundingClientRect().height);
		report();
		const observer = new ResizeObserver(report);
		observer.observe(element);
		return () => observer.disconnect();
	}, [onContentHeight, width, layout]);

	// What is selected, measured the same way, so the panel's W and H say how
	// big it is drawn even while it hugs or fills. offsetWidth is the layout
	// size, before the stage's zoom scales it.
	const selectedId = selection ? (selection.blockId ?? selection.sectionId) : null;
	useEffect(() => {
		const root = content.current;
		const element = root && selectedId ? root.querySelector<HTMLElement>(`[data-canvas-id="${CSS.escape(selectedId)}"]`) : null;
		if (!element) {
			onMeasure(null);
			return;
		}
		const report = () => onMeasure({ width: element.offsetWidth, height: element.offsetHeight });
		report();
		const observer = new ResizeObserver(report);
		observer.observe(element);
		return () => observer.disconnect();
	}, [onMeasure, selectedId, layout, width, editing]);

	const startDrag = useCallback((event: DragEvent, sectionId: string, blockId: string) => {
		event.dataTransfer.setData("application/x-juno-section", sectionId);
		event.dataTransfer.setData("application/x-juno-block", blockId);
		event.dataTransfer.effectAllowed = "move";
	}, []);

	const finishDrag = useCallback(
		(event: DragEvent, target: DropTarget) => {
			event.preventDefault();
			event.stopPropagation();
			setOver(null);
			const from = event.dataTransfer.getData("application/x-juno-section");
			const blockId = event.dataTransfer.getData("application/x-juno-block");
			if (from && blockId) onDrop(from, blockId, target);
		},
		[onDrop],
	);

	const renderBlock = (section: MailSection, block: MailBlock) => {
		const selected = selection?.blockId === block.id;
		const overThis = over?.sectionId === section.id && over.beforeBlockId === block.id;
		const place: CSSProperties = {
			...placeCss(block),
			...(block.kind === "html" ? placementFromCss(block.css) : {}),
		};

		if (editing?.blockId === block.id && (block.kind === "text" || block.kind === "heading")) {
			const frame = {
				id: block.id,
				// The box around the open text sits where the block sat, at the
				// block's own width when it has one.
				style: {
					...place,
					width: block.box.width ?? undefined,
					maxWidth: block.box.width !== null ? "100%" : undefined,
				},
				className: blockMarks(true, false),
			};
			return block.kind === "text" ? (
				<InlineText
					key={block.id}
					rich
					tag="div"
					value={block.html}
					style={editStyle(block, layout.fonts)}
					caret={editing.caret}
					host={frame}
					onCommit={(html) => onEdit(section.id, block.id, { html } as Partial<MailBlock>)}
					onClose={() => onEditing(null)}
				/>
			) : (
				<InlineText
					key={block.id}
					rich={false}
					tag={`h${block.level}`}
					value={block.content}
					style={editStyle(block, layout.fonts)}
					caret={editing.caret}
					host={frame}
					onCommit={(content) => onEdit(section.id, block.id, { content } as Partial<MailBlock>)}
					onClose={() => onEditing(null)}
				/>
			);
		}

		const textual = block.kind === "text" || block.kind === "heading";
		const attrs: HTMLAttributes<HTMLElement> = {
			// A picture keeps its own role, so its alt text is still read out.
			role: block.kind === "image" && block.src ? undefined : "presentation",
			draggable: true,
			onDragStart: (event) => startDrag(event, section.id, block.id),
			onDragEnd: () => setOver(null),
			onDragOver: (event) => {
				event.preventDefault();
				event.stopPropagation();
				setOver({ sectionId: section.id, beforeBlockId: block.id });
			},
			onDrop: (event) => finishDrag(event, { sectionId: section.id, beforeBlockId: block.id }),
			onClick: (event) => {
				event.stopPropagation();
				onSelect({ sectionId: section.id, blockId: block.id });
			},
			onDoubleClick: (event) => {
				if (!textual) return;
				event.stopPropagation();
				onSelect({ sectionId: section.id, blockId: block.id });
				onEditing({ blockId: block.id, caret: { x: event.clientX, y: event.clientY } });
			},
			title: textual ? "Double-click to edit the text" : undefined,
		};

		return (
			<BlockView
				key={block.id}
				block={block}
				inputs={inputs}
				fonts={layout.fonts}
				host={{ id: block.id, attrs, place, className: blockMarks(selected, overThis) }}
			/>
		);
	};

	return (
		<div
			style={{
				width,
				minHeight: layout.minHeight,
				color: "var(--canvas-ink)",
				...MAIL_SHELL,
				...fillCss(layout.fill),
				background: layout.fill ? undefined : "var(--canvas-paper)",
			}}
			className="shadow-[var(--shadow-popover)]"
			onClick={() => onSelect(null)}
			role="presentation"
		>
			<style>{CLIENT_DEFAULTS}</style>
			<div ref={content} data-canvas-content>
				{layout.sections.map((section: MailSection) => {
					if (section.hidden) return null;
					const sectionSelected = selection?.sectionId === section.id && !selection.blockId;
					const overEnd = over?.sectionId === section.id && over.beforeBlockId === null;
					const shown = section.blocks.filter((block) => !block.hidden);
					return (
						<div
							key={section.id}
							data-canvas-id={section.id}
							role="presentation"
							onClick={(event) => {
								event.stopPropagation();
								onSelect({ sectionId: section.id });
							}}
							onDragOver={(event) => {
								event.preventDefault();
								setOver({ sectionId: section.id, beforeBlockId: null });
							}}
							onDragLeave={() => setOver(null)}
							onDrop={(event) => finishDrag(event, { sectionId: section.id, beforeBlockId: null })}
							style={sectionCss(section)}
							className={`outline-offset-[-2px] ${
								sectionSelected
									? "outline-2 outline-[var(--accent)]"
									: overEnd
										? "outline-2 outline-dashed outline-[var(--accent)]"
										: "hover:outline-1 hover:outline-[var(--line-strong)]"
							}`}
						>
							{shown.length === 0 && section.box.minHeight === null ? (
								// Only on the canvas: an empty section is sent as nothing, and
								// this is what there is to click and to drop onto. One with a
								// height of its own is drawn at that height, because it is a
								// divider or a gap and the height is the point of it.
								<p
									data-canvas-chrome
									style={{ gridColumn: "1 / -1" }}
									className="flex-1 px-3 py-6 text-center text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)]"
								>
									{section.name} is empty
								</p>
							) : null}
							{shown.map((block) => renderBlock(section, block))}
						</div>
					);
				})}
			</div>
		</div>
	);
}
