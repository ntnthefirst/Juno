import type { MailFolder } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";

type MoveToFolderDialogProps = {
	folders: MailFolder[];
	count: number;
	busy: boolean;
	onClose: () => void;
	onMove: (folderId: string) => void;
};

/** Where a thread (or several) goes, picked from the folders the account actually has. */
export function MoveToFolderDialog({ folders, count, busy, onClose, onMove }: MoveToFolderDialogProps) {
	return (
		<Dialog title="Move to folder" onClose={onClose} width="narrow">
			<p className="mt-4 text-[var(--ink-muted)]">
				Move {count} {count === 1 ? "thread" : "threads"} to:
			</p>
			<ul className="mt-3 max-h-[320px] overflow-y-auto">
				{folders.length === 0 ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">No folders yet. Sync this account to list them.</li>
				) : (
					folders.map((folder) => (
						<li key={folder.id}>
							<button
								type="button"
								disabled={busy}
								onClick={() => onMove(folder.id)}
								style={{ height: "var(--row-height)" }}
								className="flex w-full items-center rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)] hover:bg-[var(--hover)] disabled:pointer-events-none disabled:opacity-50"
							>
								<span className="min-w-0 flex-1 truncate">{folder.name}</span>
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
