import type { ReactNode } from "react";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import type { DocumentTreeNode } from "@shared/types";

type ExplorerToolbarProps = {
	/** The open node, or null for Documents itself and for search results. */
	node: DocumentTreeNode | null;
	/** What the bar says at the left: the folder's name, or "12 results". */
	heading: string;
	/** "4 items", or how many are selected. */
	count: string;
	/** The node's own buttons: Add files and New folder, or the template ones. */
	children?: ReactNode;
};

/**
 * The bar above the content: where you are, with the client's or project's
 * avatar, what is in it, and what can be added to it.
 */
export function ExplorerToolbar({ node, heading, count, children }: ExplorerToolbarProps) {
	return (
		<div className="flex h-[52px] flex-none items-center gap-3 border-b border-[var(--line)] px-4">
			<div className="flex min-w-0 flex-1 items-center gap-2.5">
				{node && (node.kind === "client" || node.kind === "project") ? (
					<Avatar name={node.name} size={24} shape="square" />
				) : (
					<span className="flex-none text-[var(--accent)]">
						<Icon
							name={!node ? "documents" : node.kind === "templates" ? "templates" : node.kind === "unfiled" ? "inbox" : "folder"}
							size={18}
						/>
					</span>
				)}
				<h2 className="min-w-0 truncate text-base font-[var(--weight-medium)]" title={heading}>
					{heading}
				</h2>
				{/* Polite, so a search says how many it found without the focus leaving the field. */}
				<span aria-live="polite" className="tabular flex-none text-sm text-[var(--ink-muted)]">
					{count}
				</span>
			</div>
			<div className="flex flex-none items-center gap-1.5">{children}</div>
		</div>
	);
}
