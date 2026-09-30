import { useEffect, useState } from "react";
import type { ProjectStorageInfo } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { formatBytes } from "./format";

type StorageDialogProps = {
	projectId: string;
	onClose: () => void;
	/** The folder moved, so anything showing a file path has to read again. */
	onMoved: () => void;
};

/**
 * Where this project's files are, and how to put them somewhere else.
 *
 * A dialog, and not a form page, because it is a question with two answers:
 * keep them where Juno keeps everything, or keep them in a folder you chose.
 * The picker is the third control and it is the whole of the second answer.
 *
 * "Move the files across" defaults to on, because a person who changes the
 * folder almost always means the files too. Turning it off is the case where
 * the files are already at the destination, which happens when a folder is
 * being reconnected after a restore.
 */
export function StorageDialog({ projectId, onClose, onMoved }: StorageDialogProps) {
	const [info, setInfo] = useState<ProjectStorageInfo | null>(null);
	const [move, setMove] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.projects
			.storage(projectId)
			.then((found) => {
				if (!cancelled) setInfo(found);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	async function run(action: () => Promise<ProjectStorageInfo | null>) {
		setBusy(true);
		setError(null);
		try {
			const next = await action();
			// Null is a cancelled picker, which writes nothing and is not an error.
			if (next) {
				setInfo(next);
				onMoved();
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
		setBusy(false);
	}

	return (
		<Dialog title="Where this project's files are kept" onClose={onClose} width="base">
			{info === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<div className="flex flex-col gap-5">
					<div>
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{info.mode === "app"
								? "In Juno's own folder, which is backed up with your database."
								: "In a folder you chose. It is not part of a Juno backup."}
						</p>
						<p
							data-selectable
							className="mt-2 break-all rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-mono text-[length:var(--text-sm)]"
						>
							{info.path}
						</p>
						<p className="tabular mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{info.exists
								? `${info.fileCount} ${info.fileCount === 1 ? "file" : "files"}, ${formatBytes(info.byteSize)}`
								: "The folder is not there yet. It is made when the first file is added."}
						</p>
					</div>

					<label className="flex items-start gap-2 text-[length:var(--text-sm)]">
						<input
							type="checkbox"
							checked={move}
							onChange={(event) => setMove(event.target.checked)}
							className="mt-0.5 accent-[var(--accent)]"
						/>
						<span>
							Move the files across.
							<span className="block text-[var(--ink-muted)]">
								Off leaves them where they are, for a folder that already holds them.
							</span>
						</span>
					</label>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="primary"
							disabled={busy}
							onClick={() => void run(() => window.juno.projects.chooseStorageFolder(projectId, move))}
						>
							<Icon name="folder-open" />
							Choose a folder
						</Button>
						{info.mode === "custom" ? (
							<Button
								disabled={busy}
								onClick={() => void run(() => window.juno.projects.useAppStorage(projectId, move))}
							>
								Back to Juno's folder
							</Button>
						) : null}
						<Button
							disabled={busy}
							onClick={() => {
								void window.juno.projects.openStorageFolder(projectId).catch((cause: unknown) => {
									setError(messageOf(cause));
								});
							}}
						>
							Open it
						</Button>
					</div>

					<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Files you added as links are not in here. They stay where they already were, and
						moving this folder does not touch them.
					</p>

					{error ? (
						<div className="border-l-2 border-[var(--risk)] pl-3">
							<p className="font-[var(--weight-medium)] text-[var(--risk)]">
								Could not change where the files are kept.
							</p>
							<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{error}
							</p>
						</div>
					) : null}
				</div>
			)}
		</Dialog>
	);
}
