import { useState } from "react";
import type { MailFolder } from "@shared/types";
import { Checkbox } from "../../../components/Checkbox";
import { messageOf } from "../../../lib/errors";
import { SectionError } from "../Section";

type AccountFoldersProps = {
	folders: MailFolder[] | null;
	onChanged: (folder: MailFolder) => void;
};

/** Which folders the sync pulls. The list comes from the last sync. */
export function AccountFolders({ folders, onChanged }: AccountFoldersProps) {
	const [error, setError] = useState<string | null>(null);

	async function toggle(folder: MailFolder) {
		try {
			onChanged(await window.juno.mail.folders.setSyncEnabled(folder.id, !folder.syncEnabled));
			setError(null);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	return (
		<>
			{folders === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : folders.length === 0 ? (
				<p className="text-[var(--ink-muted)]">No folders listed yet. Sync the account first.</p>
			) : (
				<ul className="max-w-[620px]">
					{folders.map((folder) => (
						<li key={folder.id}>
							<label
								className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-2 hover:bg-[var(--hover)]"
								style={{ height: "var(--row-height)" }}
							>
								<Checkbox checked={folder.syncEnabled} onChange={() => void toggle(folder)} />
								<span className="min-w-0 flex-1 truncate">{folder.path}</span>
								<span className="tabular text-sm text-[var(--ink-muted)]">
									{folder.messageCount > 0 ? folder.messageCount : ""}
								</span>
							</label>
						</li>
					))}
				</ul>
			)}
			<SectionError message={error} />
		</>
	);
}
