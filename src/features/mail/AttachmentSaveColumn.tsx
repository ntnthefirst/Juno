import { useState } from "react";
import type { AttachmentDocument, DocumentPlace, ThreadDocumentPlace } from "@shared/types";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "../documents/DocumentOwnerFields";
import { choiceOf, LINK_LABELS, linkOfferFor, placeOfChoice, type ConversationFiling } from "./attachment-place";

type AttachmentSaveColumnProps = {
	/** The document this attachment already is, by its bytes. Then it is opened, not saved again. */
	document: AttachmentDocument | null;
	onOpenDocument: (document: AttachmentDocument) => void;
	/** Where the pickers start: the conversation's place, or the one its mail points at. */
	place: ThreadDocumentPlace | null;
	filing: ConversationFiling;
	busy: boolean;
	onSave: (place: DocumentPlace, linkThread: boolean) => void;
	/** Into the conversation's project files, when it has a project. */
	onAddToProject?: () => void;
	projectName?: string;
};

/**
 * The column beside an attachment's preview: keep it in Documents, under the
 * conversation's project and client unless changed here, or open the
 * document it already is. Saving checks it against the documents already kept
 * there first, the same way a drop does.
 */
export function AttachmentSaveColumn({
	document,
	onOpenDocument,
	place,
	filing,
	busy,
	onSave,
	onAddToProject,
	projectName,
}: AttachmentSaveColumnProps) {
	const [owner, setOwner] = useState<DocumentOwnerChoice>(() => choiceOf(place));
	const offer = linkOfferFor(owner, filing);
	const [link, setLink] = useState(!filing.clientId && !filing.projectId);
	return (
		<div className="flex flex-col gap-4 px-6 py-5">
			<section>
				<h3 className="border-b border-[var(--line)] pb-2 text-base font-[var(--weight-medium)]">
					{document ? "In documents" : "Save to documents"}
				</h3>
				{document ? (
					<>
						<p className="mt-3 text-sm text-[var(--ink-muted)]">This exact file is already kept as {document.title}.</p>
						<div className="mt-4">
							<Button size="dense" onClick={() => onOpenDocument(document)}>
								Open in documents
							</Button>
						</div>
					</>
				) : (
					<>
						<p className="mt-3 text-sm text-[var(--ink-muted)]">
							{place && !place.linked
								? `This mail looks like part of ${place.name}. Change it before saving if it is not.`
								: "Kept under the client and project of this conversation. Change either before saving."}
						</p>
						<div className="mt-4">
							<DocumentOwnerFields value={owner} onChange={setOwner} disabled={busy} />
						</div>
						{offer ? (
							<label className="mt-4 flex cursor-pointer items-center gap-3 text-sm">
								<Checkbox checked={link} disabled={busy} onChange={(event) => setLink(event.target.checked)} />
								<span>{LINK_LABELS[offer]}</span>
							</label>
						) : null}
						<div className="mt-4">
							<Button
								variant="primary"
								size="dense"
								disabled={busy}
								onClick={() => onSave(placeOfChoice(owner), offer !== null && link)}
							>
								{busy ? "Saving" : "Save to documents"}
							</Button>
						</div>
					</>
				)}
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
