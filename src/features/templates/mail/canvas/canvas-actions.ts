/**
 * Pure edits over a MailLayout. Every function returns a new layout rather
 * than mutating the one it was given, so the editor's state update is always
 * `setLayout(next)` and React sees a real change.
 *
 * The defaults are duplicated from electron/main/services/mail-layout.ts for
 * the same reason layout-actions.ts duplicates the page margin: the renderer
 * cannot import electron/main (architecture.md section 7). The compiler is
 * still the only thing that turns any of this into HTML, so a value that
 * drifts here shows up as a preview that does not match, not as output nobody
 * checked.
 *
 * The layout is a tree now (docs/editors.md section 2): a container or a
 * columns table can hold other containers, columns tables and blocks, and a
 * columns table holds its blocks one level further down, in a cell. Every
 * function below that finds, inserts, removes or moves a node works at any
 * depth, addressed by id alone, because a caller on the canvas or in the
 * layers never knows in advance how deep the thing it is pointing at sits.
 */
import type {
	MailBlock,
	MailBoxStyle,
	MailColumns,
	MailColumnsCell,
	MailContainer,
	MailEffect,
	MailFill,
	MailLayout,
	MailNode,
	MailSectionLayout,
	MailSides,
	MailSpacing,
	MailTextStyle,
} from "@shared/types";

/** Matches MAX_DEPTH in services/mail-layout.ts: a container nests one level deeper than its parent; a columns table's cells do not, the way the parser counts it. */
const MAX_DEPTH = 8;

function isContainer(node: MailNode): node is MailContainer {
	return node.kind === "container";
}

function isColumns(node: MailNode): node is MailColumns {
	return node.kind === "columns";
}

export function newId(): string {
	return crypto.randomUUID();
}

export function noSpacing(): MailSpacing {
	return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function allSides(): MailSides {
	return { top: true, right: true, bottom: true, left: true };
}

export function emptyBox(): MailBoxStyle {
	return {
		fill: null,
		padding: noSpacing(),
		borderWidth: 0,
		borderColor: null,
		borderStyle: "solid",
		borderSides: allSides(),
		strokeHidden: false,
		borderRadius: 0,
		corners: null,
		opacity: 1,
		effects: [],
		width: null,
		minHeight: null,
		clip: false,
		customCss: null,
	};
}

/** A flat colour as a fill, which is where every fill control starts. */
export function solidFill(color: string): MailFill {
	return { kind: "solid", color, hidden: false };
}

/** The shadow the effects list adds, at values that are visible without being
 * the only thing anybody sees. */
export function newShadow(inset: boolean): MailEffect {
	return { kind: "shadow", inset, x: 0, y: inset ? 1 : 2, blur: 6, spread: 0, color: "#16161d", opacity: 0.2, hidden: false };
}

export function newBlur(): MailEffect {
	return { kind: "blur", radius: 4, hidden: false };
}

export function defaultText(): MailTextStyle {
	return {
		color: null,
		fontFamily: null,
		fontSize: null,
		lineHeight: null,
		letterSpacing: null,
		weight: "normal",
		italic: false,
		decoration: "none",
		transform: "none",
		align: "left",
		verticalAlign: "top",
	};
}

export function stackLayout(): MailSectionLayout {
	return { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false };
}

/** A container with nothing in it, tagged `section`: what every section has always been. */
export function emptySection(name = "Section"): MailContainer {
	return {
		id: newId(),
		kind: "container",
		tag: "section",
		name,
		hidden: false,
		alignSelf: "auto",
		grow: 0,
		layout: stackLayout(),
		box: emptyBox(),
		children: [],
	};
}

/**
 * A section as an author adds one: with room around what goes in it, the way a
 * message's own sections have. `emptySection` stays bare, because it is also
 * what a section is reduced to when the last one is removed, and the room is
 * a choice somebody makes rather than something every section has.
 */
export function newSection(name = "Section"): MailContainer {
	return { ...emptySection(name), box: { ...emptyBox(), padding: { top: 24, right: 24, bottom: 24, left: 24 } } };
}

/**
 * What a new template starts from: a frame that fills the mail client, drawn
 * at 600 until a breakpoint says otherwise, and one section with room in it.
 */
export function emptyLayout(): MailLayout {
	return {
		version: 2,
		width: 600,
		widthMode: "fill",
		minHeight: 320,
		fill: null,
		fonts: [],
		customCss: null,
		children: [newSection("Body")],
		breakpoints: [],
	};
}

export type BlockKind = MailBlock["kind"];

/**
 * What the toolbar inserts. A code block is not on the list: it is what any
 * block becomes with "Convert to HTML", and what the code view puts anything
 * it could not place into, rather than something started empty. Neither is a
 * divider or a spacer: a section with a height, a fill or a stroke on one side
 * is both, and it is one thing to learn instead of three. The two still load
 * and still compile, so a template that has them keeps them.
 */
export const BLOCK_KINDS: BlockKind[] = ["text", "heading", "button", "image", "field"];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
	text: "Text",
	heading: "Heading",
	button: "Button",
	image: "Image",
	field: "Input",
	divider: "Divider",
	spacer: "Spacer",
	html: "HTML",
};

/**
 * Matches newBlock in electron/main/services/mail-layout.ts.
 *
 * A button and a picture hug their content, the way they do in Figma: in a
 * section that stretches what is in it, a button would otherwise be drawn as
 * a bar the width of the message and a picture blown up to it.
 */
export function newBlock(kind: BlockKind): MailBlock {
	const common = { id: newId(), grow: 0, alignSelf: "auto" as const, hidden: false };
	switch (kind) {
		case "heading":
			return {
				...common,
				kind,
				tag: "h2",
				content: "Titel",
				text: { ...defaultText(), weight: "semibold" },
				box: emptyBox(),
			};
		case "button":
			return {
				...common,
				alignSelf: "start",
				kind,
				label: "Bekijk",
				href: "https://",
				background: "#4a3fa0",
				color: "#ffffff",
				radius: 4,
				text: { ...defaultText(), weight: "semibold", align: "center" },
				box: { ...emptyBox(), padding: { top: 10, right: 18, bottom: 10, left: 18 } },
			};
		case "image":
			return { ...common, alignSelf: "start", kind, src: "", alt: "", width: null, align: "left", href: null, box: emptyBox() };
		case "divider":
			return { ...common, kind, color: "#e3e2ec", thickness: 1, box: emptyBox(), grow: 1 };
		case "spacer":
			return { ...common, kind, height: 16 };
		case "field":
			return { ...common, kind, inputKey: "", text: defaultText(), box: emptyBox() };
		case "html":
			return { ...common, kind, html: "", css: "" };
		case "text":
		default:
			return { ...common, kind: "text", tag: "p", html: "Tekst", text: defaultText(), box: emptyBox() };
	}
}

/* -------------------------------------------------------------- the tree */

/**
 * Where a node's children live: a container's and a cell's own `children`, or
 * the frame's own top level for `null`. A columns table is not one of these:
 * its blocks sit one level further down, in a cell, which is why moving into
 * a columns table itself is never offered, only into one of its cells.
 */
export type ParentId = string | null;

/** Every id under a node, itself included: a container's and a cell's own id count, because a cell is a valid drop target. */
function idsIn(node: MailNode): string[] {
	if (isContainer(node)) return [node.id, ...node.children.flatMap(idsIn)];
	if (isColumns(node)) {
		return [
			node.id,
			...node.rows.flatMap((row) => [row.id, ...row.cells.flatMap((cell) => [cell.id, ...cell.children.flatMap(idsIn)])]),
		];
	}
	return [node.id];
}

/**
 * The ids of every container and columns table a node passes through on the
 * way down to `id`, root first, not including `id` itself. Null when `id`
 * is not in the tree at all.
 */
export function pathTo(layout: MailLayout, id: string): string[] | null {
	function walk(nodes: MailNode[], trail: string[]): string[] | null {
		for (const node of nodes) {
			if (node.id === id) return trail;
			if (isContainer(node)) {
				const found = walk(node.children, [...trail, node.id]);
				if (found) return found;
			} else if (isColumns(node)) {
				for (const row of node.rows) {
					for (const cell of row.cells) {
						if (cell.id === id) return [...trail, node.id];
						const found = walk(cell.children, [...trail, node.id, cell.id]);
						if (found) return found;
					}
				}
			}
		}
		return null;
	}
	return walk(layout.children, []);
}

/** The container or cell holding `id` directly, or null for the frame's own top level. Undefined when `id` is nowhere in the tree. */
export function parentOf(layout: MailLayout, id: string): ParentId | undefined {
	const path = pathTo(layout, id);
	if (path === null) return undefined;
	return path.length > 0 ? path[path.length - 1]! : null;
}

/** A container, a columns table or a block, found anywhere in the tree. Never a cell: findCell is that search. */
export function findNode(layout: MailLayout, id: string): MailNode | null {
	function walk(nodes: MailNode[]): MailNode | null {
		for (const node of nodes) {
			if (node.id === id) return node;
			if (isContainer(node)) {
				const found = walk(node.children);
				if (found) return found;
			} else if (isColumns(node)) {
				for (const row of node.rows) {
					for (const cell of row.cells) {
						const found = walk(cell.children);
						if (found) return found;
					}
				}
			}
		}
		return null;
	}
	return walk(layout.children);
}

export function findCell(layout: MailLayout, id: string): MailColumnsCell | null {
	function walk(nodes: MailNode[]): MailColumnsCell | null {
		for (const node of nodes) {
			if (isContainer(node)) {
				const found = walk(node.children);
				if (found) return found;
			} else if (isColumns(node)) {
				for (const row of node.rows) {
					for (const cell of row.cells) {
						if (cell.id === id) return cell;
						const found = walk(cell.children);
						if (found) return found;
					}
				}
			}
		}
		return null;
	}
	return walk(layout.children);
}

/** The children of a container or a cell, or the frame's own top level for null. Null when `parentId` names neither. */
export function childrenOf(layout: MailLayout, parentId: ParentId): MailNode[] | null {
	if (parentId === null) return layout.children;
	function walk(nodes: MailNode[]): MailNode[] | null {
		for (const node of nodes) {
			if (isContainer(node)) {
				if (node.id === parentId) return node.children;
				const found = walk(node.children);
				if (found) return found;
			} else if (isColumns(node)) {
				for (const row of node.rows) {
					for (const cell of row.cells) {
						if (cell.id === parentId) return cell.children;
						const found = walk(cell.children);
						if (found) return found;
					}
				}
			}
		}
		return null;
	}
	return walk(layout.children);
}

/**
 * The first child of a container, of a columns table (its first row's first
 * cell), or of a cell: what Enter steps into, and what a double click on a
 * parent opens.
 */
export function firstChildOf(layout: MailLayout, id: string): string | null {
	const node = findNode(layout, id);
	if (node && isContainer(node)) return node.children[0]?.id ?? null;
	if (node && isColumns(node)) return node.rows[0]?.cells[0]?.id ?? null;
	const cell = !node ? findCell(layout, id) : null;
	return cell ? (cell.children[0]?.id ?? null) : null;
}

/** Rewrites the children of the container or cell `parentId` (or the frame's own top level, for null). A no-op, same reference back, when `parentId` names neither. */
function withChildrenOf(nodes: MailNode[], parentId: string, updater: (children: MailNode[]) => MailNode[]): MailNode[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (changed) return node;
		if (isContainer(node)) {
			if (node.id === parentId) {
				changed = true;
				return { ...node, children: updater(node.children) };
			}
			const children = withChildrenOf(node.children, parentId, updater);
			if (children !== node.children) {
				changed = true;
				return { ...node, children };
			}
			return node;
		}
		if (isColumns(node)) {
			let rowsChanged = false;
			const rows = node.rows.map((row) => {
				let cellsChanged = false;
				const cells = row.cells.map((cell) => {
					if (cell.id === parentId) {
						cellsChanged = true;
						return { ...cell, children: updater(cell.children) };
					}
					const children = withChildrenOf(cell.children, parentId, updater);
					if (children !== cell.children) {
						cellsChanged = true;
						return { ...cell, children };
					}
					return cell;
				});
				if (cellsChanged) rowsChanged = true;
				return cellsChanged ? { ...row, cells } : row;
			});
			if (rowsChanged) {
				changed = true;
				return { ...node, rows };
			}
			return node;
		}
		return node;
	});
	return changed ? next : nodes;
}

export function withChildren(layout: MailLayout, parentId: ParentId, updater: (children: MailNode[]) => MailNode[]): MailLayout {
	if (parentId === null) return { ...layout, children: updater(layout.children) };
	const children = withChildrenOf(layout.children, parentId, updater);
	return children === layout.children ? layout : { ...layout, children };
}

/** Finds a node by id anywhere in the tree and replaces it with `fn`'s result. A no-op when `id` is not there, or names a cell rather than a node. */
function mapNode(layout: MailLayout, id: string, fn: (node: MailNode) => MailNode): MailLayout {
	function walk(nodes: MailNode[]): MailNode[] {
		let changed = false;
		const next = nodes.map((node) => {
			if (changed) return node;
			if (node.id === id) {
				changed = true;
				return fn(node);
			}
			if (isContainer(node)) {
				const children = walk(node.children);
				if (children !== node.children) {
					changed = true;
					return { ...node, children };
				}
				return node;
			}
			if (isColumns(node)) {
				let rowsChanged = false;
				const rows = node.rows.map((row) => {
					let cellsChanged = false;
					const cells = row.cells.map((cell) => {
						const children = walk(cell.children);
						if (children !== cell.children) {
							cellsChanged = true;
							return { ...cell, children };
						}
						return cell;
					});
					if (cellsChanged) rowsChanged = true;
					return cellsChanged ? { ...row, cells } : row;
				});
				if (rowsChanged) {
					changed = true;
					return { ...node, rows };
				}
				return node;
			}
			return node;
		});
		return changed ? next : nodes;
	}
	const children = walk(layout.children);
	return children === layout.children ? layout : { ...layout, children };
}

/** Finds a cell by id anywhere in the tree and replaces it with `fn`'s result. */
function mapCell(layout: MailLayout, id: string, fn: (cell: MailColumnsCell) => MailColumnsCell): MailLayout {
	function walk(nodes: MailNode[]): MailNode[] {
		let changed = false;
		const next = nodes.map((node) => {
			if (changed) return node;
			if (isContainer(node)) {
				const children = walk(node.children);
				if (children !== node.children) {
					changed = true;
					return { ...node, children };
				}
				return node;
			}
			if (isColumns(node)) {
				let rowsChanged = false;
				const rows = node.rows.map((row) => {
					let cellsChanged = false;
					const cells = row.cells.map((cell) => {
						if (cell.id === id) {
							cellsChanged = true;
							return fn(cell);
						}
						const children = walk(cell.children);
						if (children !== cell.children) {
							cellsChanged = true;
							return { ...cell, children };
						}
						return cell;
					});
					if (cellsChanged) rowsChanged = true;
					return cellsChanged ? { ...row, cells } : row;
				});
				if (rowsChanged) {
					changed = true;
					return { ...node, rows };
				}
				return node;
			}
			return node;
		});
		return changed ? next : nodes;
	}
	const children = walk(layout.children);
	return children === layout.children ? layout : { ...layout, children };
}

/**
 * The depth a node dropped into `parentId`'s children would be parsed at,
 * matching the parser's own counter exactly (services/mail-layout.ts): a
 * container's children are one deeper than the container itself, a columns
 * table's cells are not deeper than the columns table. Null when `parentId`
 * is not a container or a cell.
 */
function depthForChildrenOf(layout: MailLayout, parentId: ParentId): number | null {
	if (parentId === null) return 0;
	const path = pathTo(layout, parentId);
	if (path === null) return null;
	const containerDepth = path.filter((ancestorId) => {
		const ancestor = findNode(layout, ancestorId);
		return ancestor !== null && isContainer(ancestor);
	}).length;
	const node = findNode(layout, parentId);
	if (node && isContainer(node)) return containerDepth + 1;
	if (!node && findCell(layout, parentId)) return containerDepth;
	return null;
}

/** Whether `node` and every container or columns table under it fits starting at `depth`, the way the parser refuses anything past MAX_DEPTH outright. */
function fits(node: MailNode, depth: number): boolean {
	if (isContainer(node)) return depth < MAX_DEPTH && node.children.every((child) => fits(child, depth + 1));
	if (isColumns(node)) return depth < MAX_DEPTH && node.rows.every((row) => row.cells.every((cell) => cell.children.every((child) => fits(child, depth))));
	return true;
}

/**
 * Whether `id` can be moved into `toParentId`'s children: not into itself,
 * not into its own descendant (a cell of its own columns table included), and
 * not past the nesting the parser allows.
 */
export function canMoveInto(layout: MailLayout, id: string, toParentId: ParentId): boolean {
	if (id === toParentId) return false;
	const node = findNode(layout, id);
	if (!node) return false;
	if (toParentId !== null && (isContainer(node) || isColumns(node)) && idsIn(node).includes(toParentId)) return false;
	const depth = depthForChildrenOf(layout, toParentId);
	if (depth === null) return false;
	return fits(node, depth);
}

/** A node removed from wherever it lives, with no guarantee the frame still has anything in it. */
function withoutNode(layout: MailLayout, id: string): MailLayout {
	const parentId = parentOf(layout, id);
	if (parentId === undefined) return layout;
	return withChildren(layout, parentId, (children) => children.filter((node) => node.id !== id));
}

/**
 * Removes a container, a columns table or a block, wherever it is. A cell or
 * an id nothing in the tree has is left alone: a cell is structural, fixed by
 * its table, and is not something Delete takes away on its own.
 *
 * A canvas always has something at the top level: taking the last one away
 * would leave nowhere to select and nowhere to drop a block on, which reads as
 * a broken editor rather than as an empty one.
 */
export function removeNode(layout: MailLayout, id: string): MailLayout {
	if (!findNode(layout, id)) return layout;
	const next = withoutNode(layout, id);
	return next.children.length === 0 ? { ...next, children: [emptySection("Body")] } : next;
}

/** Puts `node` into `parentId`'s children, straight after `afterId`, or at the end when that is null or not there. */
export function insertNode(layout: MailLayout, parentId: ParentId, node: MailNode, afterId: string | null): MailLayout {
	return withChildren(layout, parentId, (children) => {
		const index = afterId ? children.findIndex((entry) => entry.id === afterId) : -1;
		if (index < 0) return [...children, node];
		const next = [...children];
		next.splice(index + 1, 0, node);
		return next;
	});
}

/**
 * Moves `id` into `toParentId`'s children, in front of `beforeId`, or at the
 * end when that is null or not found there. Refuses the move outright
 * (returns the layout unchanged) when it would nest the node into itself, into
 * its own descendant, or past the depth the parser allows.
 */
export function moveNode(layout: MailLayout, id: string, toParentId: ParentId, beforeId: string | null): MailLayout {
	if (id === beforeId) return layout;
	if (!canMoveInto(layout, id, toParentId)) return layout;
	const node = findNode(layout, id);
	if (!node) return layout;
	const without = withoutNode(layout, id);
	const moved = withChildren(without, toParentId, (children) => {
		const index = beforeId ? children.findIndex((entry) => entry.id === beforeId) : -1;
		const next = [...children];
		if (index < 0) next.push(node);
		else next.splice(index, 0, node);
		return next;
	});
	return moved.children.length === 0 ? { ...moved, children: [emptySection("Body")] } : moved;
}

/**
 * Alt with an arrow: one place earlier or later among its own siblings, in the
 * same parent. Refuses at either end, the way it always has: nothing happens
 * at the first child on Alt+Up, or at the last on Alt+Down.
 */
export function moveWithinParent(layout: MailLayout, id: string, by: -1 | 1): MailLayout {
	const parentId = parentOf(layout, id);
	if (parentId === undefined) return layout;
	return withChildren(layout, parentId, (children) => {
		const index = children.findIndex((node) => node.id === id);
		const target = index + by;
		if (index < 0 || target < 0 || target >= children.length) return children;
		const next = [...children];
		const [moved] = next.splice(index, 1);
		if (moved) next.splice(target, 0, moved);
		return next;
	});
}

/**
 * The next or the previous layer among `id`'s own siblings, going round at the
 * ends: Tab and Shift+Tab. Stays put when `id` has no siblings to step to.
 */
export function siblingOf(layout: MailLayout, id: string, by: -1 | 1): string {
	const parentId = parentOf(layout, id);
	if (parentId === undefined) return id;
	const children = childrenOf(layout, parentId);
	if (!children) return id;
	const index = children.findIndex((node) => node.id === id);
	if (index < 0) return id;
	const count = children.length;
	const next = children[(index + by + count) % count];
	return next ? next.id : id;
}

/* ------------------------------------------------ copying, duplicating */

/** A copy of a block with an id of its own, which is what a paste or a duplicate puts down. */
export function cloneBlock(block: MailBlock): MailBlock {
	return { ...structuredClone(block), id: newId() };
}

/**
 * A copy of a node and everything in it, every id new: a container's or a
 * columns table's children, and a columns table's rows and cells too.
 */
export function cloneNode(node: MailNode): MailNode {
	if (isContainer(node)) {
		return { ...structuredClone(node), id: newId(), children: node.children.map(cloneNode) };
	}
	if (isColumns(node)) {
		return {
			...structuredClone(node),
			id: newId(),
			rows: node.rows.map((row) => ({
				...structuredClone(row),
				id: newId(),
				cells: row.cells.map((cell) => ({
					...structuredClone(cell),
					id: newId(),
					children: cell.children.map(cloneNode),
				})),
			})),
		};
	}
	return cloneBlock(node);
}

/** A copy of a container, kept for callers that know they have one (pasting a copied section). */
export function cloneSection(section: MailContainer): MailContainer {
	return cloneNode(section) as MailContainer;
}

/**
 * Every id an original and its clone share a position for, original first:
 * the node itself, and everything nested under it, rows and cells included.
 * What `copyOverrides` (breakpoints.ts) needs to give a duplicate what its
 * original changes at each breakpoint.
 */
export function pairIds(original: MailNode, copy: MailNode): [string, string][] {
	const pairs: [string, string][] = [[original.id, copy.id]];
	if (isContainer(original) && isContainer(copy)) {
		original.children.forEach((child, index) => {
			const other = copy.children[index];
			if (other) pairs.push(...pairIds(child, other));
		});
	} else if (isColumns(original) && isColumns(copy)) {
		original.rows.forEach((row, rowIndex) => {
			const otherRow = copy.rows[rowIndex];
			if (!otherRow) return;
			row.cells.forEach((cell, cellIndex) => {
				const otherCell = otherRow.cells[cellIndex];
				if (!otherCell) return;
				pairs.push([cell.id, otherCell.id]);
				cell.children.forEach((child, index) => {
					const otherChild = otherCell.children[index];
					if (otherChild) pairs.push(...pairIds(child, otherChild));
				});
			});
		});
	}
	return pairs;
}

/**
 * A copy of `id`, dropped straight after the original in the same parent,
 * every id in the copied subtree new. Null when `id` names a cell or nothing
 * in the tree: neither is a node Ctrl+D can duplicate on its own.
 */
export function duplicateNode(layout: MailLayout, id: string): { layout: MailLayout; id: string; pairs: [string, string][] } | null {
	const node = findNode(layout, id);
	const parentId = parentOf(layout, id);
	if (!node || parentId === undefined) return null;
	const copy = cloneNode(node);
	return { layout: insertNode(layout, parentId, copy, id), id: copy.id, pairs: pairIds(node, copy) };
}

/* --------------------------------------------------------------- editing */

export function updateSection(layout: MailLayout, id: string, patch: Partial<Omit<MailContainer, "id" | "kind" | "children">>): MailLayout {
	return mapNode(layout, id, (node) => (node.kind === "container" ? { ...node, ...patch } : node));
}

export function updateColumns(layout: MailLayout, id: string, patch: Partial<Omit<MailColumns, "id" | "kind" | "rows">>): MailLayout {
	return mapNode(layout, id, (node) => (node.kind === "columns" ? { ...node, ...patch } : node));
}

export function updateCell(layout: MailLayout, id: string, patch: Partial<Omit<MailColumnsCell, "id" | "children">>): MailLayout {
	return mapCell(layout, id, (cell) => ({ ...cell, ...patch }));
}

export function updateBlock(layout: MailLayout, id: string, patch: Partial<MailBlock>): MailLayout {
	return mapNode(layout, id, (node) =>
		// The cast holds because a patch only ever carries fields of the block it
		// came from: the inspector builds it from the selected block, so there is
		// no path that puts a heading's tag onto a spacer.
		node.kind !== "container" && node.kind !== "columns" ? ({ ...node, ...patch } as MailBlock) : node,
	);
}

/** Whether what is selected is still there, which an undo can change under it. */
export function selectionIn(layout: MailLayout, id: string | null): boolean {
	if (!id) return true;
	return findNode(layout, id) !== null || findCell(layout, id) !== null;
}

/* --------------------------------------------------------- selection colours */

function textColors(text: MailTextStyle): (string | null)[] {
	return [text.color];
}

function boxColors(box: MailBoxStyle): (string | null)[] {
	return [
		box.fill?.kind === "solid" ? box.fill.color : null,
		box.fill?.kind === "gradient" ? box.fill.from : null,
		box.fill?.kind === "gradient" ? box.fill.to : null,
		box.borderWidth > 0 ? box.borderColor : null,
		...box.effects.map((effect) => (effect.kind === "shadow" ? effect.color : null)),
	];
}

function blockColors(block: MailBlock): (string | null)[] {
	switch (block.kind) {
		case "button":
			return [block.background, block.color, ...boxColors(block.box)];
		case "divider":
			return [block.color, ...boxColors(block.box)];
		case "spacer":
		case "html":
			return [];
		default:
			return ["text" in block ? textColors(block.text) : [], boxColors(block.box)].flat();
	}
}

/** A node's own colours, and everything nested under it: a container's or a columns table's children too. */
function nodeColors(node: MailNode): (string | null)[] {
	if (isContainer(node)) return [...boxColors(node.box), ...node.children.flatMap(nodeColors)];
	if (isColumns(node)) {
		return [...boxColors(node.box), ...node.rows.flatMap((row) => row.cells.flatMap(cellColors))];
	}
	return blockColors(node);
}

function cellColors(cell: MailColumnsCell): (string | null)[] {
	return [...boxColors(cell.box), ...cell.children.flatMap(nodeColors)];
}

/**
 * Every colour used in what is selected, or in the whole message when nothing
 * is: Figma's selection colours. Lowercased, so `#FFF` and `#fff` are one
 * swatch, and in the order they first appear.
 */
export function colorsIn(layout: MailLayout, id: string | null): string[] {
	const node = id ? findNode(layout, id) : null;
	const cell = id && !node ? findCell(layout, id) : null;
	const found = node
		? nodeColors(node)
		: cell
			? cellColors(cell)
			: [
					layout.fill?.kind === "solid" ? layout.fill.color : null,
					layout.fill?.kind === "gradient" ? layout.fill.from : null,
					layout.fill?.kind === "gradient" ? layout.fill.to : null,
					...layout.children.flatMap(nodeColors),
				];
	return [...new Set(found.filter((color): color is string => Boolean(color)).map((color) => color.toLowerCase()))];
}

function swap(color: string, from: string, to: string): string {
	return color.toLowerCase() === from ? to : color;
}

function swapNullable(color: string | null, from: string, to: string): string | null {
	return color === null ? null : swap(color, from, to);
}

function recolorBox(box: MailBoxStyle, from: string, to: string): MailBoxStyle {
	const fill =
		box.fill?.kind === "solid"
			? { ...box.fill, color: swap(box.fill.color, from, to) }
			: box.fill?.kind === "gradient"
				? { ...box.fill, from: swap(box.fill.from, from, to), to: swap(box.fill.to, from, to) }
				: null;
	return {
		...box,
		fill,
		borderColor: swapNullable(box.borderColor, from, to),
		effects: box.effects.map((effect) => (effect.kind === "shadow" ? { ...effect, color: swap(effect.color, from, to) } : effect)),
	};
}

function recolorBlock(block: MailBlock, from: string, to: string): MailBlock {
	switch (block.kind) {
		case "button":
			return {
				...block,
				background: swap(block.background, from, to),
				color: swap(block.color, from, to),
				box: recolorBox(block.box, from, to),
			};
		case "divider":
			return { ...block, color: swap(block.color, from, to), box: recolorBox(block.box, from, to) };
		case "spacer":
		case "html":
			// A code block's colours are in its code, where they are edited.
			return block;
		case "image":
			return { ...block, box: recolorBox(block.box, from, to) };
		default:
			return {
				...block,
				text: { ...block.text, color: swapNullable(block.text.color, from, to) },
				box: recolorBox(block.box, from, to),
			};
	}
}

function recolorNode(node: MailNode, from: string, to: string): MailNode {
	if (isContainer(node)) {
		return { ...node, box: recolorBox(node.box, from, to), children: node.children.map((child) => recolorNode(child, from, to)) };
	}
	if (isColumns(node)) {
		return {
			...node,
			box: recolorBox(node.box, from, to),
			rows: node.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => recolorCell(cell, from, to)) })),
		};
	}
	return recolorBlock(node, from, to);
}

function recolorCell(cell: MailColumnsCell, from: string, to: string): MailColumnsCell {
	return { ...cell, box: recolorBox(cell.box, from, to), children: cell.children.map((child) => recolorNode(child, from, to)) };
}

/**
 * Changes one colour to another everywhere in what is selected, the way
 * Figma's selection colours do. Nothing outside the selection is touched.
 */
export function replaceColor(layout: MailLayout, id: string | null, from: string, to: string): MailLayout {
	const match = from.toLowerCase();
	if (!id) {
		const fill =
			layout.fill?.kind === "solid"
				? { ...layout.fill, color: swap(layout.fill.color, match, to) }
				: layout.fill?.kind === "gradient"
					? { ...layout.fill, from: swap(layout.fill.from, match, to), to: swap(layout.fill.to, match, to) }
					: null;
		return { ...layout, fill, children: layout.children.map((node) => recolorNode(node, match, to)) };
	}
	if (findNode(layout, id)) return mapNode(layout, id, (node) => recolorNode(node, match, to));
	if (findCell(layout, id)) return mapCell(layout, id, (cell) => recolorCell(cell, match, to));
	return layout;
}
