import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { DocumentTreeNode } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { FileName } from "../../components/FileName";
import { Icon, type IconName } from "../../components/Icon";
import { LIST_COMBOS, matchesCombo } from "../../lib/shortcuts";
import { DRAG_TYPE, encodeDrag, type DragPayload } from "./drop-routing";
import { countWithin, parentOf, ROOT_KEY, TEMPLATES_KEY, visibleRows } from "./explorer-tree";
import { OFFSCREEN_ROW } from "./offscreen-row";
import { RenameField } from "./RenameField";
import { RowShell } from "./RowShell";

type FolderTreeProps = {
	roots: DocumentTreeNode[];
	/** How many templates the Templates node holds, which the tree does not count as documents. */
	templateCount: number;
	openKey: string;
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onOpen: (key: string) => void;
	renamingKey: string | null;
	onRename: (node: DocumentTreeNode, name: string) => void;
	onRenameEnd: () => void;
	onStartRename: (node: DocumentTreeNode) => void;
	onNodeMenu: (node: DocumentTreeNode, event: MouseEvent) => void;
	/** Delete on a folder of the owner's own asks to delete it, as its menu does. */
	onDeleteNode: (node: DocumentTreeNode) => void;
	/** Whether something dragged may land on this node. Null is the top, Documents itself. */
	canDrop: (node: DocumentTreeNode | null) => boolean;
	onDrop: (node: DocumentTreeNode | null, event: DragEvent) => void;
};

const NODE_ICONS: Partial<Record<DocumentTreeNode["kind"], IconName>> = {
	folder: "folder",
	unfiled: "inbox",
	templates: "templates",
};

/** How long a drag rests on a closed node before it opens, so a file can be carried down the tree. */
const SPRING_OPEN_MS = 700;

/**
 * The tree at the left of Documents: every client with its projects and the
 * owner's folders, the projects of the owner's own, Unfiled and Templates
 * (decision 75). A node remembers whether it was open; the count beside a
 * node is everything inside it.
 *
 * It is a tree to the keyboard as well: up and down move and open, left
 * closes or goes up, right opens or goes in, F2 renames a folder and Delete
 * deletes one. Documents
 * and folders dragged onto a node move there, and files from outside are
 * added to it.
 */
export function FolderTree({
	roots,
	templateCount,
	openKey,
	expanded,
	onToggle,
	onOpen,
	renamingKey,
	onRename,
	onRenameEnd,
	onStartRename,
	onNodeMenu,
	onDeleteNode,
	canDrop,
	onDrop,
}: FolderTreeProps) {
	const rows = useMemo(() => visibleRows(roots, expanded, 1), [roots, expanded]);
	const items = useRef(new Map<string, HTMLElement>());
	const [dropKey, setDropKey] = useState<string | null>(null);
	const moved = useRef(false);

	// A drag resting on a closed node opens it after a moment, so a file can be carried down the tree.
	useEffect(() => {
		if (dropKey === null) return;
		const resting = rows.find((row) => row.node.key === dropKey)?.node;
		if (!resting || resting.children.length === 0 || expanded.has(resting.key)) return;
		const timer = window.setTimeout(() => onToggle(resting.key), SPRING_OPEN_MS);
		return () => window.clearTimeout(timer);
	}, [dropKey, rows, expanded, onToggle]);

	useEffect(() => {
		if (!moved.current) return;
		moved.current = false;
		const element = items.current.get(openKey);
		element?.focus({ preventScroll: true });
		element?.scrollIntoView({ block: "nearest" });
	}, [openKey]);

	const order = [ROOT_KEY, ...rows.map((row) => row.node.key)];
	const nodeOf = (key: string) => rows.find((row) => row.node.key === key)?.node ?? null;

	function go(key: string) {
		moved.current = true;
		onOpen(key);
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (renamingKey !== null) return;
		const at = order.indexOf(openKey);
		const node = nodeOf(openKey);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const next = order[Math.min(order.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
			if (next) go(next);
		} else if (event.key === "ArrowRight") {
			event.preventDefault();
			if (!node || node.children.length === 0) return;
			if (!expanded.has(node.key)) onToggle(node.key);
			else go(node.children[0]!.key);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			if (node && expanded.has(node.key) && node.children.length > 0) onToggle(node.key);
			else if (node) go(parentOf(roots, node.key)?.key ?? ROOT_KEY);
		} else if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			go(event.key === "Home" ? ROOT_KEY : order[order.length - 1]!);
		} else if (matchesCombo(event.nativeEvent, LIST_COMBOS.rename) && node?.kind === "folder") {
			event.preventDefault();
			onStartRename(node);
		} else if (matchesCombo(event.nativeEvent, LIST_COMBOS.remove) && node?.kind === "folder") {
			event.preventDefault();
			onDeleteNode(node);
		}
	}

	function dropHandlers(node: DocumentTreeNode | null) {
		const key = node?.key ?? ROOT_KEY;
		if (!canDrop(node)) return {};
		const carries = (event: DragEvent) => {
			const types = Array.from(event.dataTransfer.types);
			return types.includes(DRAG_TYPE) || types.includes("Files");
		};
		return {
			onDragOver: (event: DragEvent<HTMLElement>) => {
				if (!carries(event)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes("Files") ? "copy" : "move";
				setDropKey(key);
			},
			onDragLeave: (event: DragEvent<HTMLElement>) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
				setDropKey((current) => (current === key ? null : current));
			},
			onDrop: (event: DragEvent<HTMLElement>) => {
				if (!carries(event)) return;
				event.preventDefault();
				event.stopPropagation();
				setDropKey(null);
				onDrop(node, event);
			},
		};
	}

	function rowClass(key: string): string {
		const open = key === openKey;
		const dropping = key === dropKey;
		return `group flex w-full min-w-0 cursor-default items-center gap-2 rounded-[var(--radius-md)] pr-2 text-left text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)] ${
			dropping
				? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] ring-inset"
				: open
					? "bg-[var(--accent-soft)] text-[var(--ink)]"
					: "text-[var(--ink)] hover:bg-[var(--hover)]"
		}`;
	}

	return (
		<div role="tree" aria-label="Folders" onKeyDown={onKeyDown} className="flex flex-col gap-px">
			<button
				ref={(element) => {
					if (element) items.current.set(ROOT_KEY, element);
					else items.current.delete(ROOT_KEY);
				}}
				type="button"
				role="treeitem"
				aria-level={1}
				aria-selected={openKey === ROOT_KEY}
				tabIndex={openKey === ROOT_KEY ? 0 : -1}
				data-tree-node={ROOT_KEY}
				onClick={() => onOpen(ROOT_KEY)}
				style={{ height: "var(--row-height)", paddingLeft: 8 }}
				className={rowClass(ROOT_KEY)}
				{...dropHandlers(null)}
			>
				<span className="w-4 flex-none" />
				<span className={`flex-none ${openKey === ROOT_KEY ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"}`}>
					<Icon name="documents" size={16} />
				</span>
				<span className="min-w-0 flex-1 truncate font-[var(--weight-medium)]">Documents</span>
			</button>
			{rows.map(({ node, depth }) => {
				const open = expanded.has(node.key);
				const hasChildren = node.children.length > 0;
				const count = node.key === TEMPLATES_KEY ? templateCount : countWithin(node);
				const icon = NODE_ICONS[node.kind];
				const drag: DragPayload | null =
					node.kind === "folder" && node.folderId && renamingKey !== node.key
						? { kind: "folder", key: node.key, folderId: node.folderId }
						: null;
				return (
					<RowShell
						key={node.key}
						asButton={renamingKey !== node.key}
						ref={(element) => {
							if (element) items.current.set(node.key, element);
							else items.current.delete(node.key);
						}}
						role="treeitem"
						aria-level={depth + 1}
						aria-selected={openKey === node.key}
						aria-expanded={hasChildren ? open : undefined}
						tabIndex={openKey === node.key ? 0 : -1}
						data-tree-node={node.key}
						draggable={drag !== null}
						onDragStart={(event) => {
							if (!drag) return;
							event.dataTransfer.setData(DRAG_TYPE, encodeDrag(drag));
							event.dataTransfer.effectAllowed = "move";
						}}
						onClick={() => onOpen(node.key)}
						onDoubleClick={() => {
							if (hasChildren) onToggle(node.key);
						}}
						onContextMenu={(event) => onNodeMenu(node, event)}
						style={{ height: "var(--row-height)", paddingLeft: 8 + (depth - 1) * 16, ...OFFSCREEN_ROW }}
						className={rowClass(node.key)}
						{...dropHandlers(node)}
					>
						<span
							role="presentation"
							onClick={(event) => {
								if (!hasChildren) return;
								event.stopPropagation();
								onToggle(node.key);
							}}
							onDoubleClick={(event) => event.stopPropagation()}
							className={`flex h-4 w-4 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-faint)] ${hasChildren ? "hover:text-[var(--ink)]" : ""}`}
						>
							{hasChildren ? (
								<Icon
									name="chevron-right"
									size={12}
									className={`transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] ${open ? "rotate-90" : ""}`}
								/>
							) : null}
						</span>
						{node.kind === "client" || node.kind === "project" ? (
							<Avatar name={node.name} size={18} shape="square" />
						) : (
							<span
								className={`flex-none ${
									openKey === node.key || node.kind === "folder" ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
								}`}
							>
								<Icon name={icon ?? "folder"} size={16} />
							</span>
						)}
						{renamingKey === node.key ? (
							<RenameField value={node.name} onCommit={(name) => onRename(node, name)} onCancel={onRenameEnd} />
						) : (
							<span className="flex min-w-0 flex-1">
								<FileName name={node.name} />
							</span>
						)}
						{count > 0 && renamingKey !== node.key ? (
							<span className="tabular flex-none text-micro text-[var(--ink-muted)]">{count}</span>
						) : null}
					</RowShell>
				);
			})}
		</div>
	);
}
