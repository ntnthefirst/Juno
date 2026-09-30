import { useState, type DragEvent, type ReactNode } from "react";
import type { MailBlock, MailColumns, MailColumnsCell, MailContainer, MailLayout, MailNode } from "@shared/types";
import { Icon, type IconName } from "../../../../components/Icon";
import { BLOCK_KIND_LABELS, hasClick } from "./canvas-actions";
import type { DropTarget, Selection } from "./CanvasView";

function isContainer(node: MailNode): node is MailContainer {
	return node.kind === "container";
}

function isColumns(node: MailNode): node is MailColumns {
	return node.kind === "columns";
}

type LayerTreeProps = {
	layout: MailLayout;
	selection: Selection;
	onSelect: (selection: Selection) => void;
	/** Figma's eye: a hidden layer stays here and is left out of the message. Never asked for a cell, which has no eye of its own. */
	onHidden: (id: string, hidden: boolean) => void;
	/** A node let go on another row: into a container or a cell (its own row's end), in front of a sibling, or, on the drop zone under the tree, at the frame's own end. */
	onDrop: (id: string, target: DropTarget) => void;
	/** Alt with an arrow on a focused row: one place up or down, in the same parent. */
	onStep: (id: string, by: -1 | 1) => void;
};

/** The one key everything here, and the canvas, drags a node with. */
const NODE_ID = "application/x-juno-node";

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

/** A list has its own glyph, and a heading of the first three levels the one that says which. */
function blockIcon(block: MailBlock): IconName {
	if (block.kind === "text" && (block.tag === "ul" || block.tag === "ol")) return "list";
	if (block.kind === "heading" && (block.tag === "h1" || block.tag === "h2" || block.tag === "h3")) return block.tag;
	return BLOCK_ICONS[block.kind];
}

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

/** Where something being dragged would land, drawn as a line over that row, or a highlight over a row it would land inside. */
type Over = { id: string; edge: "before" | "inside" } | null;

type RowProps = {
	id: string;
	/** What kind of row this is, on the row's own button as `data-layer-kind`: what a script drives the layers with reads, rather than a class that is free to change with the styling. */
	kind: "container" | "columns" | "cell" | "block";
	depth: number;
	icon: IconName;
	label: string;
	/** The HTML it is written as, when that says more than its name: a container's tag, a heading's level. */
	tag?: string;
	count?: number;
	/** Whether a click on it goes somewhere, shown as a link glyph. */
	linked?: boolean;
	selected: boolean;
	over: Over;
	hidden?: { value: boolean; onChange: () => void };
	draggable: boolean;
	expanded?: { open: boolean; onToggle: () => void };
	onSelect: () => void;
	onStep: (by: -1 | 1) => void;
	onDragStart: (event: DragEvent) => void;
	onDragOver: (event: DragEvent) => void;
	onDrop: (event: DragEvent) => void;
	onDragEnd: () => void;
};

/**
 * One row: the chevron, the icon, the name, the count, and the eye.
 *
 * Kept at the module's own top level, not nested inside LayerTree, because a
 * component declared inside another is a new function every render: React
 * would then see a different row type on every selection change and remount
 * the whole row, which drops a drag already in flight.
 */
function Row({ id, kind, depth, icon, label, tag, count, linked, selected, over, hidden, draggable, expanded, onSelect, onStep, onDragStart, onDragOver, onDrop, onDragEnd }: RowProps) {
	const overBefore = over?.id === id && over.edge === "before";
	const overInside = over?.id === id && over.edge === "inside";
	return (
		<div
			draggable={draggable}
			onDragStart={draggable ? onDragStart : undefined}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onDragEnd={onDragEnd}
			className={`group flex items-center rounded-[var(--radius-sm)] ${
				selected ? "bg-[var(--accent-soft)]" : overInside ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
			} ${hidden?.value ? "opacity-60" : ""} ${overBefore ? line : ""}`}
		>
			{expanded ? (
				<button
					type="button"
					aria-label={expanded.open ? `Collapse ${label}` : `Expand ${label}`}
					aria-expanded={expanded.open}
					onClick={expanded.onToggle}
					style={{ marginLeft: depth * 12 }}
					className="flex h-[28px] w-[20px] flex-none items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)]"
				>
					<Icon name={expanded.open ? "chevron-down" : "chevron-right"} size={11} className="flex-none" />
				</button>
			) : (
				<span style={{ marginLeft: depth * 12 + 20 }} />
			)}
			<button
				type="button"
				aria-current={selected ? "true" : undefined}
				title={draggable ? "Drag to reorder. Alt and an arrow move it too" : undefined}
				data-layer-kind={kind}
				data-layer-depth={depth}
				onClick={onSelect}
				onKeyDown={(event) => {
					if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
					event.preventDefault();
					onStep(event.key === "ArrowUp" ? -1 : 1);
				}}
				className={`flex h-[28px] min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[length:var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
					expanded ? "font-[var(--weight-medium)]" : ""
				} ${selected ? "text-[var(--accent)]" : expanded ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
			>
				<Icon name={icon} size={12} className="flex-none" />
				<span className="truncate">{label}</span>
				{tag ? (
					<span className="flex-none font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)]">{tag}</span>
				) : null}
				{linked ? (
					<span data-layer-linked title="Has an on-click action" className="flex-none text-[var(--ink-muted)]">
						<Icon name="link" size={11} />
					</span>
				) : null}
				{count !== undefined ? (
					<span className="tabular ml-auto flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">{count}</span>
				) : null}
			</button>
			{hidden ? <Eye name={label} hidden={hidden.value} onToggle={hidden.onChange} /> : null}
		</div>
	);
}

const line = "shadow-[inset_0_2px_0_0_var(--accent)]";

/**
 * The layers: every container, columns table, cell and block, indented by how
 * deep it sits, with a chevron on anything that can hold something.
 *
 * It is the same selection the canvas has, so clicking a row here points the
 * design panel at the same thing clicking the node does. A hidden layer is not
 * drawn on the canvas, so this is also the only place to select one, and its
 * row stays dimmed until it is shown again.
 *
 * Order is changed here, the way it is in Figma: a node dragged onto another
 * node's row lands in front of it; dragged onto a container's, a columns
 * table's or a cell's own row lands inside it, at the end; dragged onto the
 * strip under the tree lands at the very end of the frame. Alt and an arrow
 * move the focused row one place, in its own parent, for a keyboard. A cell
 * has no row of its own to drag, because it is fixed by its table, but it is
 * still a drop target, the way its children make it a parent.
 */
export function LayerTree({ layout, selection, onSelect, onHidden, onDrop, onStep }: LayerTreeProps) {
	const [closed, setClosed] = useState<string[]>([]);
	const [over, setOver] = useState<Over>(null);

	const toggle = (id: string) => {
		setClosed((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
	};

	const startDrag = (event: DragEvent, id: string) => {
		event.stopPropagation();
		event.dataTransfer.setData(NODE_ID, id);
		event.dataTransfer.effectAllowed = "move";
	};

	/**
	 * Where a row offers to drop something dragged over it: the upper half is
	 * always "in front of this row", in its own parent; the lower half is "at
	 * the end of this row's own children", when it has any to hold, which is
	 * how a container, a columns table or a cell is dropped into rather than
	 * only ever reordered past. A leaf offers the upper reading everywhere on
	 * its row, since it has nothing to hold.
	 */
	const dragOverRow = (event: DragEvent, id: string, canHold: boolean) => {
		event.preventDefault();
		event.stopPropagation();
		const bounds = event.currentTarget.getBoundingClientRect();
		const lower = canHold && event.clientY - bounds.top > bounds.height / 2;
		setOver({ id, edge: lower ? "inside" : "before" });
	};

	const dropOnRow = (event: DragEvent, insideTarget: DropTarget | undefined, beforeTarget: DropTarget) => {
		event.preventDefault();
		event.stopPropagation();
		const bounds = event.currentTarget.getBoundingClientRect();
		const lower = insideTarget !== undefined && event.clientY - bounds.top > bounds.height / 2;
		setOver(null);
		const id = event.dataTransfer.getData(NODE_ID);
		if (id) onDrop(id, lower ? insideTarget! : beforeTarget);
	};

	/** A container, a columns table or a block: one row, and its children when it is open. */
	function renderNode(node: MailNode, depth: number, parentId: string | null): ReactNode {
		if (isContainer(node)) {
			const open = !closed.includes(node.id);
			const insideTarget = { parentId: node.id, beforeId: null };
			const beforeTarget = { parentId, beforeId: node.id };
			return (
				<li key={node.id}>
					<Row
						id={node.id}
						kind="container"
						depth={depth}
						icon="tool-section"
						label={node.name}
						tag={node.tag}
						count={node.children.length}
						linked={hasClick(node.actions)}
						selected={selection?.id === node.id}
						over={over}
						hidden={{ value: node.hidden, onChange: () => onHidden(node.id, !node.hidden) }}
						draggable
						expanded={{ open, onToggle: () => toggle(node.id) }}
						onSelect={() => onSelect({ id: node.id })}
						onStep={(by) => onStep(node.id, by)}
						onDragStart={(event) => startDrag(event, node.id)}
						onDragOver={(event) => dragOverRow(event, node.id, true)}
						onDrop={(event) => dropOnRow(event, insideTarget, beforeTarget)}
						onDragEnd={() => setOver(null)}
					/>
					{open ? <ul className="flex flex-col">{node.children.map((child) => renderNode(child, depth + 1, node.id))}</ul> : null}
				</li>
			);
		}
		if (isColumns(node)) {
			const open = !closed.includes(node.id);
			const beforeTarget = { parentId, beforeId: node.id };
			return (
				<li key={node.id}>
					<Row
						id={node.id}
						kind="columns"
						depth={depth}
						icon="tool-columns"
						label={node.name}
						tag="table"
						count={node.rows.reduce((total, row) => total + row.cells.length, 0)}
						linked={hasClick(node.actions)}
						selected={selection?.id === node.id}
						over={over}
						hidden={{ value: node.hidden, onChange: () => onHidden(node.id, !node.hidden) }}
						draggable
						expanded={{ open, onToggle: () => toggle(node.id) }}
						onSelect={() => onSelect({ id: node.id })}
						onStep={(by) => onStep(node.id, by)}
						onDragStart={(event) => startDrag(event, node.id)}
						// A columns table has no children of its own to drop into: only
						// one of its cells is, so its own row never offers "inside".
						onDragOver={(event) => dragOverRow(event, node.id, false)}
						onDrop={(event) => dropOnRow(event, undefined, beforeTarget)}
						onDragEnd={() => setOver(null)}
					/>
					{open ? (
						<ul className="flex flex-col">
							{node.rows.map((row, rowIndex) =>
								row.cells.map((cell, cellIndex) => renderCell(cell, node, depth + 1, rowIndex, cellIndex)),
							)}
						</ul>
					) : null}
				</li>
			);
		}
		const label = blockLabel(node);
		const beforeTarget = { parentId, beforeId: node.id };
		return (
			<li key={node.id}>
				<Row
					id={node.id}
					kind="block"
					depth={depth}
					icon={blockIcon(node)}
					label={label}
					tag={node.kind === "heading" || (node.kind === "text" && node.tag !== "p") ? node.tag : undefined}
					linked={hasClick(node.actions)}
					selected={selection?.id === node.id}
					over={over}
					hidden={{ value: node.hidden, onChange: () => onHidden(node.id, !node.hidden) }}
					draggable
					onSelect={() => onSelect({ id: node.id })}
					onStep={(by) => onStep(node.id, by)}
					onDragStart={(event) => startDrag(event, node.id)}
					onDragOver={(event) => dragOverRow(event, node.id, false)}
					onDrop={(event) => dropOnRow(event, undefined, beforeTarget)}
					onDragEnd={() => setOver(null)}
				/>
			</li>
		);
	}

	/** A cell: no row of its own to drag, since its table fixes it in place, but a row to select, to expand, and to drop into. */
	function renderCell(cell: MailColumnsCell, columns: MailColumns, depth: number, rowIndex: number, cellIndex: number): ReactNode {
		const open = !closed.includes(cell.id);
		const label = columns.rows.length > 1 ? `Row ${rowIndex + 1}, cell ${cellIndex + 1}` : `Cell ${cellIndex + 1}`;
		const insideTarget = { parentId: cell.id, beforeId: null };
		return (
			<li key={cell.id}>
				<Row
					id={cell.id}
					kind="cell"
					depth={depth}
					icon="grid"
					label={label}
					count={cell.children.length}
					linked={hasClick(cell.actions)}
					selected={selection?.id === cell.id}
					over={over}
					draggable={false}
					expanded={{ open, onToggle: () => toggle(cell.id) }}
					onSelect={() => onSelect({ id: cell.id })}
					onStep={() => undefined}
					onDragStart={() => undefined}
					onDragOver={(event) => dragOverRow(event, cell.id, true)}
					onDrop={(event) => dropOnRow(event, insideTarget, insideTarget)}
					onDragEnd={() => setOver(null)}
				/>
				{open ? <ul className="flex flex-col">{cell.children.map((child) => renderNode(child, depth + 1, cell.id))}</ul> : null}
			</li>
		);
	}

	return (
		<ul data-layers className="flex flex-col" onDragLeave={() => setOver(null)}>
			{layout.children.map((node) => renderNode(node, 0, null))}
			<li
				aria-hidden
				onDragOver={(event) => dragOverRow(event, "$end", false)}
				onDrop={(event) => dropOnRow(event, undefined, { parentId: null, beforeId: null })}
				className={`h-[16px] rounded-[var(--radius-sm)] ${over?.id === "$end" ? line : ""}`}
			/>
		</ul>
	);
}
