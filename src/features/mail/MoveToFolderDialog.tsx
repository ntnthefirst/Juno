import { useState } from "react";
import type { MailFolder } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { buildFolderTree, flattenTree, SPECIAL_ICONS, SPECIAL_LABELS, specialFolders } from "./folder-tree";

type MoveToFolderDialogProps = {
	folders: MailFolder[];
	count: number;
	busy: boolean;
	onClose: () => void;
	onMove: (folderId: string) => void;
};

/**
 * Where a thread goes, picked from the folders the account actually has, in the
 * shape the sidebar shows them. With more than a handful of folders the list is
 * filtered by typing, because scrolling a mailbox's folder list to find one is
 * the slow way round.
 */
export function MoveToFolderDialog({ folders, count, busy, onClose, onMove }: MoveToFolderDialogProps) {
	const [term, setTerm] = useState("");

	const rows = [
		...specialFolders(folders).map(({ folder, use }) => ({
			folder,
			label: SPECIAL_LABELS[use],
			icon: SPECIAL_ICONS[use],
			depth: 0,
		})),
		...flattenTree(buildFolderTree(folders)).map(({ node, depth }) => ({
			folder: node.folder,
			label: node.label,
			icon: "projects" as const,
			depth,
		})),
	];
	const needle = term.trim().toLowerCase();
	const shown = needle
		? rows.filter(
				(row) => row.label.toLowerCase().includes(needle) || row.folder.path.toLowerCase().includes(needle),
			)
		: rows;

	return (
		<Dialog title="Move to folder" onClose={onClose} width="narrow">
			<p className="mt-4 text-[var(--ink-muted)]">
				Move {count} {count === 1 ? "thread" : "threads"} to:
			</p>
			{rows.length > 6 ? (
				<input
					type="search"
					value={term}
					autoFocus
					onChange={(event) => setTerm(event.target.value)}
					placeholder="Find a folder"
					aria-label="Find a folder"
					className="mt-3 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
				/>
			) : null}
			<ul className="mt-3 max-h-[320px] overflow-y-auto">
				{shown.length === 0 ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">
						{rows.length === 0 ? "No folders yet. Sync this account to list them." : "No folder matches."}
					</li>
				) : (
					shown.map((row) => (
						<li key={row.folder.id}>
							<button
								type="button"
								disabled={busy}
								onClick={() => onMove(row.folder.id)}
								style={{ height: "var(--row-height)", paddingLeft: `calc(var(--space-3) + var(--space-3) * ${row.depth})` }}
								className="flex w-full items-center gap-2 rounded-[var(--radius-md)] pr-3 text-left text-[length:var(--text-dense)] hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-50"
								title={row.folder.path}
							>
								<Icon name={row.icon} size={14} />
								<span className="min-w-0 flex-1 truncate">{row.label}</span>
							</button>
						</li>
					))
				)}
			</ul>
			<div className="mt-4 flex justify-end">
				<Button disabled={busy} onClick={onClose}>
					Cancel
				</Button>
			</div>
		</Dialog>
	);
}
