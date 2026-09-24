import { useState } from "react";
import type { MailFolder } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { messageOf } from "../../lib/errors";

export type FolderFormTarget =
	| { mode: "create"; accountId: string; parent: MailFolder | null }
	| { mode: "rename"; folder: MailFolder };

type FolderFormPageProps = {
	target: FolderFormTarget;
	onClose: () => void;
	onDone: (folder: MailFolder, verb: "created" | "renamed") => void;
};

/**
 * Making or renaming a folder. One field, and still a page rather than a modal,
 * because it has a field in it (decision 30) and because the folder is made on
 * the server, which can refuse it and needs somewhere to say so.
 */
export function FolderFormPage({ target, onClose, onDone }: FolderFormPageProps) {
	const [name, setName] = useState(target.mode === "rename" ? target.folder.name : "");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const folder =
				target.mode === "create"
					? await window.juno.mail.folders.create({
							accountId: target.accountId,
							name,
							parentId: target.parent?.id ?? null,
						})
					: await window.juno.mail.folders.rename(target.folder.id, name);
			onDone(folder, target.mode === "create" ? "created" : "renamed");
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<FormPage
			title={target.mode === "create" ? "New folder" : `Rename ${target.folder.name}`}
			onBack={onClose}
			backLabel="Cancel"
			description={
				target.mode === "create"
					? target.parent
						? `Inside ${target.parent.name}, on the mail server.`
						: "On the mail server, beside the inbox."
					: "The folder is renamed on the mail server. Folders inside it come with it."
			}
			actions={
				<Button variant="primary" disabled={busy || name.trim() === ""} onClick={() => void submit()}>
					{busy ? "Saving" : target.mode === "create" ? "Create folder" : "Rename"}
				</Button>
			}
		>
			<Field
				label="Name"
				value={name}
				onChange={setName}
				required
				error={error}
				placeholder="Facturen"
			/>
		</FormPage>
	);
}
