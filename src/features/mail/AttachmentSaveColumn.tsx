import { useState } from "react";
import { Button } from "../../components/Button";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "../documents/DocumentOwnerFields";

type AttachmentSaveColumnProps = {
	/** Where the conversation is filed, which is where the file is kept unless the person says otherwise. */
	clientId: string | null;
	projectId: string | null;
	onSave: (owner: DocumentOwnerChoice) => void;
	/** Into the conversation's project files, when it has a project. */
	onAddToProject?: () => void;
	projectName?: string;
};

/**
 * The column beside an attachment's preview: keep it in Documents, under the
 * conversation's client and project unless changed here. Saving checks it
 * against the documents already kept there first, the same way a drop does.
 */
export function AttachmentSaveColumn({ clientId, projectId, onSave, onAddToProject, projectName }: AttachmentSaveColumnProps) {
	const [owner, setOwner] = useState<DocumentOwnerChoice>({ clientId: clientId ?? "", projectId: projectId ?? "" });
	return (
		<div className="flex flex-col gap-4 px-6 py-5">
			<section>
				<h3 className="border-b border-[var(--line)] pb-2 text-base font-[var(--weight-medium)]">Save to documents</h3>
				<p className="mt-3 text-sm text-[var(--ink-muted)]">
					Kept under the client and project of this conversation. Change either before saving.
				</p>
				<div className="mt-4">
					<DocumentOwnerFields value={owner} onChange={setOwner} />
				</div>
				<div className="mt-4">
					<Button variant="primary" size="dense" onClick={() => onSave(owner)}>
						Save to documents
					</Button>
				</div>
			</section>
			{onAddToProject && projectName ? (
				<section>
					<h3 className="border-b border-[var(--line)] pb-2 text-base font-[var(--weight-medium)]">Project files</h3>
					<p className="mt-3 text-sm text-[var(--ink-muted)]">A drawing, a photo or a price sheet can go with the project instead.</p>
					<div className="mt-4">
						<Button size="dense" onClick={onAddToProject}>
							Add to {projectName} files
						</Button>
					</div>
				</section>
			) : null}
		</div>
	);
}
