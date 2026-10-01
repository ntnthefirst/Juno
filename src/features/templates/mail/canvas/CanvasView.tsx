import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type HTMLAttributes } from "react";
import type { MailBlock, MailColumns, MailColumnsCell, MailContainer, MailFont, MailLayout, MailNode, TemplateInput } from "@shared/types";
import { assetKeyOf } from "@shared/paper";
import { Icon } from "../../../../components/Icon";
import { asListItems, canMoveInto, firstChildOf } from "./canvas-actions";
import {
	blockMarginCss,
	boxCss,
	cellCss,
	CLIENT_DEFAULTS,
	columnsCss,
	fillCss,
	LIST_INDENT,
	MAIL_SHELL,
	noPadding,
	placeCss,
	placementFromCss,
	sectionCss,
	textCss,
	verticalCss,
} from "./box-style";
import { codeMarkup } from "./code-markup";
import { editTag } from "./inline-html";
import { InlineText, type Caret } from "./InlineText";
import { isDrawable } from "../../../../lib/remote-image";
import { RemoteImage } from "./RemoteImage";

function isContainer(node: MailNode): node is MailContainer {
	return node.kind === "container";
}

function isColumns(node: MailNode): node is MailColumns {
	return node.kind === "columns";
}

/** What the design panel is pointed at: one node, wherever it sits in the tree. */
export type Selection = { id: string } | null;

/** Where a dragged node was let go: into `parentId`'s children (the frame's own top level for null), in front of `beforeId`, or at the end when that is null. */
export type DropTarget = { parentId: string | null; beforeId: string | null };

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
	onDrop: (id: string, target: DropTarget) => void;
	/** Text typed on the canvas itself, written back to the block it was typed in. */
	onEdit: (blockId: string, patch: Partial<MailBlock>) => void;
	/** Held by the editor, so adding a block or pressing Enter can open it too. */
	editing: Editing | null;
	onEditing: (editing: Editing | null) => void;
	/** How tall the content came to, so the height control can refuse to go under it. */
	onContentHeight: (height: number) => void;
	/** The size of what is selected, for the W and H fields. */
	onMeasure: (size: Measured | null) => void;
	/** A document: the pages are the sheets, so nothing is drawn behind them. */
	sheets?: boolean;
	/** A document's pictures, by the key an image block names them with (`{{asset.<key>}}`). */
	pictures?: Record<string, string>;
};

/**
 * What the canvas adds to the element a node is drawn as: its handlers, its
 * marks, and its place in its parent.
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
	pictures: Record<string, string>;
};

const NO_PICTURES: Record<string, string> = {};

/**
 * One block, drawn as the element the compiler writes for it.
 *
 * That element is its parent's flex item in the message, so it is the flex
 * item here too, with the canvas's handlers on it rather than on a box around
 * it. A box around it would be what the parent stretches and aligns, and the
 * selection would outline the room the block was given rather than the block:
 * a text block fixed at 100 pixels would be drawn as a line across the frame.
 */
function BlockView({ block, inputs, fonts, host, pictures }: BlockViewProps) {
	const own = { ...host.attrs, "data-canvas-id": host.id };
	switch (block.kind) {
		case "heading": {
			const Tag = block.tag;
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
			// A list's items are its markup: pushing them down its box with a
			// wrapping span would break the list, so it is always drawn at the top.
			const list = block.tag === "ul" || block.tag === "ol";
			const style = {
				margin: 0,
				...textCss(block.text, fonts),
				...(list ? {} : verticalCss(block.text)),
				...boxCss(block.box),
				// The bullets live in the left padding. The compiler writes the
				// same indent (LIST_INDENT in services/mail-layout.ts), and only
				// while the box has no padding of its own, which is when this
				// box's own padding here is all zero too.
				...(list && noPadding(block.box.padding) ? { paddingLeft: LIST_INDENT } : {}),
				...host.place,
			};
			// The author's own markup, shown the way it will be sent. It is
			// sanitised by the compiler on save and again on render, and this
			// surface is not where a message from anybody else is displayed.
			const markup = { __html: block.html || (list ? "<li>Punt</li>" : "Tekst") };
			// Written as its own tag, and a plain paragraph as the compiler
			// writes one, unless the markup has paragraphs of its own (textTag
			// in services/mail-layout.ts).
			const Tag = block.tag === "p" ? (/<p[\s>]/i.test(block.html) ? "div" : "p") : block.tag;
			return list || block.text.verticalAlign === "top" ? (
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
		case "image": {
			// Only a picture Juno holds is drawn. A web address is the reader's
			// mail client's to load, so it gets a box that says so (remote-image.ts).
			// A document's own picture is named by its key and drawn from Juno.
			const key = assetKeyOf(block.src);
			const src = key ? (pictures[key] ?? "") : block.src;
			const picture = src ? (
				isDrawable(src) ? (
					<img
						src={src}
						alt={block.alt}
						style={{
							display: "block",
							maxWidth: "100%",
							width: block.width ?? undefined,
							height: "auto",
						}}
					/>
				) : (
					<RemoteImage alt={block.alt} width={block.width} />
				)
			) : null;
			return picture ? (
				<span
					{...own}
					className={host.className}
					style={{
						display: "block",
						marginLeft: block.align === "center" || block.align === "right" ? "auto" : undefined,
						marginRight: block.align === "center" ? "auto" : undefined,
						...boxCss({ ...block.box, width: null }),
						...host.place,
					}}
				>
					{picture}
				</span>
			) : (
				<span
					{...own}
					style={host.place}
					className={`flex items-center gap-1.5 text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)] ${host.className}`}
				>
					<Icon name="image" size={14} /> {key ? "This picture is no longer stored" : "No image address yet"}
				</span>
			);
		}
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
			// is a column, so the code's root is stretched across it the way its
			// parent stretches that root in the message.
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

/** The outline a node is drawn with: selected, a drop landing in front of it, or hovered. */
function marks(selected: boolean, over: boolean): string {
	return `cursor-default outline-offset-[-1px] ${
		selected
			? "outline-2 outline-[var(--accent)]"
			: over
				? "outline-2 outline-dashed outline-[var(--accent)]"
				: "hover:outline-1 hover:outline-dashed hover:outline-[var(--accent)]/50"
	}`;
}

/** Half the gap on each inner side, so the total between two cells is the gap and the outer edges carry none of it. Matches cellGapDeclarations. */
function cellGapCss(index: number, count: number, gap: number, padding: { left: number; right: number }): CSSProperties {
	const half = gap / 2;
	return {
		paddingLeft: index > 0 ? padding.left + half : undefined,
		paddingRight: index < count - 1 ? padding.right + half : undefined,
	};
}

/**
 * The frame, and what is in it, drawn as the tree it is.
 *
 * Nothing on this surface can be dragged to a coordinate. A node is dropped in
 * front of a sibling, at the end of a container or a cell, or into a container
 * or a cell as its only content, and where it lands from there is decided by
 * that parent's own flex, grid or table rules, which is the whole point of the
 * model. Dropping into a container, a columns table's cell, or the frame's own
 * top level are the same operation at different addresses (canvas-actions.ts,
 * moveNode); the address is all `onDrop` is ever given.
 *
 * A click selects the element directly under the pointer, at whatever depth
 * that is: every node's own handler stops the event before it reaches an
 * ancestor's, so clicking a block nested three containers deep selects that
 * block in one click, never its parent first. A double click on a container,
 * a columns table or a cell that is already selected steps into it and
 * selects its first child, the way Figma's frame does when there is nothing
 * exposed to click directly; a double click on a text block or a heading
 * opens it for typing, as it always has.
 *
 * A hidden layer is not drawn, which is what Figma does and what the message
 * does: it is still in the layers panel, where it can be selected and shown
 * again.
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
	sheets = false,
	pictures = NO_PICTURES,
}: CanvasViewProps) {
	const content = useRef<HTMLDivElement>(null);
	const [over, setOver] = useState<DropTarget | null>(null);
	// The id being dragged, kept in state rather than read from dataTransfer
	// during dragover: most browsers only hand the payload back on drop, and
	// this is what lets the indicator skip a target the drop would refuse.
	const [draggingId, setDraggingId] = useState<string | null>(null);

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
	const selectedId = selection?.id ?? null;
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

	const DATA_ID = "application/x-juno-node";

	const startDrag = useCallback((event: DragEvent, id: string) => {
		event.stopPropagation();
		event.dataTransfer.setData(DATA_ID, id);
		event.dataTransfer.effectAllowed = "move";
		setDraggingId(id);
	}, []);

	const endDrag = useCallback(() => {
		setDraggingId(null);
		setOver(null);
	}, []);

	const dragOverTarget = useCallback(
		(event: DragEvent, target: DropTarget) => {
			event.preventDefault();
			event.stopPropagation();
			if (draggingId && !canMoveInto(layout, draggingId, target.parentId)) return;
			setOver(target);
		},
		[draggingId, layout],
	);

	const finishDrag = useCallback(
		(event: DragEvent, target: DropTarget) => {
			event.preventDefault();
			event.stopPropagation();
			setOver(null);
			const id = event.dataTransfer.getData(DATA_ID);
			if (id) onDrop(id, target);
		},
		[onDrop],
	);

	const select = useCallback(
		(event: { stopPropagation: () => void }, id: string) => {
			event.stopPropagation();
			onSelect({ id });
		},
		[onSelect],
	);

	/** A double click on a container, a columns table or a cell that is already selected: step into its first child. */
	const enter = useCallback(
		(event: { stopPropagation: () => void }, id: string) => {
			event.stopPropagation();
			if (selection?.id !== id) {
				onSelect({ id });
				return;
			}
			const first = firstChildOf(layout, id);
			if (first) onSelect({ id: first });
		},
		[layout, onSelect, selection],
	);

	const renderBlock = (block: MailBlock, parentId: string | null) => {
		const selected = selection?.id === block.id;
		const overThis = over !== null && over.parentId === parentId && over.beforeId === block.id;
		const place: CSSProperties = {
			...placeCss(block),
			...blockMarginCss(block),
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
				className: marks(true, false),
			};
			return block.kind === "text" ? (
				<InlineText
					key={block.id}
					rich
					tag={editTag(block.tag)}
					value={block.html}
					style={editStyle(block, layout.fonts)}
					caret={editing.caret}
					host={frame}
					onCommit={(html) =>
							onEdit(block.id, { html: block.tag === "ul" || block.tag === "ol" ? asListItems(html) : html } as Partial<MailBlock>)
						}
					onClose={() => onEditing(null)}
				/>
			) : (
				<InlineText
					key={block.id}
					rich={false}
					tag={block.tag}
					value={block.content}
					style={editStyle(block, layout.fonts)}
					caret={editing.caret}
					host={frame}
					onCommit={(content) => onEdit(block.id, { content } as Partial<MailBlock>)}
					onClose={() => onEditing(null)}
				/>
			);
		}

		const textual = block.kind === "text" || block.kind === "heading";
		const attrs: HTMLAttributes<HTMLElement> = {
			// A picture keeps its own role, so its alt text is still read out.
			role: block.kind === "image" && block.src ? undefined : "presentation",
			draggable: true,
			onDragStart: (event) => startDrag(event, block.id),
			onDragEnd: endDrag,
			onDragOver: (event) => dragOverTarget(event, { parentId, beforeId: block.id }),
			onDrop: (event) => finishDrag(event, { parentId, beforeId: block.id }),
			onClick: (event) => select(event, block.id),
			onDoubleClick: (event) => {
				if (!textual) return;
				event.stopPropagation();
				onSelect({ id: block.id });
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
				host={{ id: block.id, attrs, place, className: marks(selected, overThis) }}
				pictures={pictures}
			/>
		);
	};

	/** A container: its own layout, and the tree recursively inside it. */
	const renderContainer = (container: MailContainer, topLevel: boolean) => {
		const selected = selection?.id === container.id;
		const overEnd = over !== null && over.parentId === container.id && over.beforeId === null;
		const shown = container.children.filter((node) => !node.hidden);
		return (
			<div
				key={container.id}
				data-canvas-id={container.id}
				role="presentation"
				onClick={(event) => select(event, container.id)}
				onDoubleClick={(event) => enter(event, container.id)}
				onDragOver={(event) => dragOverTarget(event, { parentId: container.id, beforeId: null })}
				onDragLeave={() => setOver(null)}
				onDrop={(event) => finishDrag(event, { parentId: container.id, beforeId: null })}
				style={sectionCss(container, topLevel)}
				className={`outline-offset-[-2px] ${
					selected
						? "outline-2 outline-[var(--accent)]"
						: overEnd
							? "outline-2 outline-dashed outline-[var(--accent)]"
							: "hover:outline-1 hover:outline-[var(--line-strong)]"
				}`}
			>
				{shown.length === 0 && container.box.minHeight === null ? (
					// Only on the canvas: an empty container is sent as nothing, and
					// this is what there is to click and to drop onto. One with a
					// height of its own is drawn at that height, because it is a
					// divider or a gap and the height is the point of it.
					<p
						data-canvas-chrome
						style={{ gridColumn: "1 / -1" }}
						className="flex-1 px-3 py-6 text-center text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)]"
					>
						{container.name} is empty
					</p>
				) : null}
				{shown.map((node) => renderNode(node, container.id, false))}
			</div>
		);
	};

	/** A columns table: a row of cells laid out the way the compiled table renders. */
	const renderColumns = (columns: MailColumns, topLevel: boolean) => {
		const selected = selection?.id === columns.id;
		return (
			<table
				key={columns.id}
				data-canvas-id={columns.id}
				role="presentation"
				cellPadding={0}
				cellSpacing={0}
				onClick={(event) => select(event, columns.id)}
				// Separate, with no spacing: what a client draws for a table with no
				// border-collapse of its own, which is what the message says, and the
				// model in which a table's own padding and corners apply.
				style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, ...columnsCss(columns, topLevel) }}
				className={`outline-offset-[-2px] ${selected ? "outline-2 outline-[var(--accent)]" : "hover:outline-1 hover:outline-[var(--line-strong)]"}`}
			>
				<tbody>
					{columns.rows.map((row) => (
						<tr key={row.id} data-canvas-id={row.id}>
							{row.cells.map((cell, index) => renderCell(cell, columns, index, row.cells.length))}
						</tr>
					))}
				</tbody>
			</table>
		);
	};

	/** One cell of a columns table: its own drop target, and a parent for what it holds. */
	const renderCell = (cell: MailColumnsCell, columns: MailColumns, index: number, count: number) => {
		const selected = selection?.id === cell.id;
		const overEnd = over !== null && over.parentId === cell.id && over.beforeId === null;
		const shown = cell.children.filter((node) => !node.hidden);
		return (
			<td
				key={cell.id}
				data-canvas-id={cell.id}
				role="presentation"
				onClick={(event) => select(event, cell.id)}
				onDoubleClick={(event) => enter(event, cell.id)}
				onDragOver={(event) => dragOverTarget(event, { parentId: cell.id, beforeId: null })}
				onDragLeave={() => setOver(null)}
				onDrop={(event) => finishDrag(event, { parentId: cell.id, beforeId: null })}
				style={{ ...cellCss(cell), ...cellGapCss(index, count, columns.gap, cell.box.padding) }}
				className={`outline-offset-[-2px] ${
					selected
						? "outline-2 outline-[var(--accent)]"
						: overEnd
							? "outline-2 outline-dashed outline-[var(--accent)]"
							: "hover:outline-1 hover:outline-[var(--line-strong)]"
				}`}
			>
				{shown.length === 0 ? (
					<span
						data-canvas-chrome
						className="block px-2 py-4 text-center text-[length:var(--text-micro)] text-[var(--canvas-ink-muted)]"
					>
						Empty
					</span>
				) : null}
				{shown.map((node) => renderNode(node, cell.id, true))}
			</td>
		);
	};

	const renderNode = (node: MailNode, parentId: string | null, topLevel: boolean) => {
		if (isContainer(node)) return renderContainer(node, topLevel);
		if (isColumns(node)) return renderColumns(node, topLevel);
		return renderBlock(node, parentId);
	};

	const topShown = layout.children.filter((node) => !node.hidden);
	const overRootEnd = over !== null && over.parentId === null && over.beforeId === null;

	return (
		<div
			style={{
				width,
				minHeight: layout.minHeight,
				color: "var(--canvas-ink)",
				...MAIL_SHELL,
				...fillCss(layout.fill),
				background: sheets ? "transparent" : layout.fill ? undefined : "var(--canvas-paper)",
			}}
			className={sheets ? undefined : "shadow-[var(--shadow-popover)]"}
			onClick={() => onSelect(null)}
			onDragOver={(event) => dragOverTarget(event, { parentId: null, beforeId: null })}
			onDrop={(event) => finishDrag(event, { parentId: null, beforeId: null })}
			role="presentation"
		>
			<style>{CLIENT_DEFAULTS}</style>
			<div
				ref={content}
				data-canvas-content
				className={overRootEnd ? "outline-2 outline-dashed outline-[var(--accent)] outline-offset-[-2px]" : undefined}
			>
				{topShown.map((node) => renderNode(node, null, true))}
			</div>
		</div>
	);
}
