import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentPlace, ThreadDocumentPlace } from "@shared/types";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { IconAction } from "../../components/IconAction";
import { useContentHost } from "../../lib/content-host";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "../documents/DocumentOwnerFields";
import { choiceOf, LINK_LABELS, linkOfferFor, placeOfChoice, type ConversationFiling } from "./attachment-place";

type AttachmentPlacePageProps = {
	/** The names of the attachments being saved, for the list under the question. */
	fileNames: string[];
	/** Where the pickers start: the conversation's place, or the one its mail points at. */
	place: ThreadDocumentPlace | null;
	filing: ConversationFiling;
	busy: boolean;
	onSave: (place: DocumentPlace, linkThread: boolean) => void;
	onCancel: () => void;
};

/**
 * Where a mail's attachments go, when that is the question: the conversation
 * is filed under nothing, or the person picked Save to. It starts from the
 * project the mail suggestions point at, and offers to file the conversation
 * there in the same step, which the service does as one call.
 *
 * It covers the content area the way adding files does, because it has
 * fields in it (decision 30).
 */
export function AttachmentPlacePage({ fileNames, place, filing, busy, onSave, onCancel }: AttachmentPlacePageProps) {
	const host = useContentHost();
	const [choice, setChoice] = useState<DocumentOwnerChoice>(() => choiceOf(place));
	const offer = linkOfferFor(choice, filing);
	// Ticked by default for a conversation filed under nothing: the person is saying where it belongs.
	const [link, setLink] = useState(!filing.clientId && !filing.projectId);

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector("[role='dialog']")) return;
			event.preventDefault();
			onCancel();
		}
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onCancel]);

	const one = fileNames.length === 1;
	const frame = (
		<div
			role="region"
			aria-label="Save to documents"
			data-add-files
			className="animate-scale absolute inset-0 z-30 flex flex-col bg-[var(--surface)]"
		>
			<div className="flex h-[56px] flex-none items-center gap-3 border-b border-[var(--line)] pr-4 pl-2">
				<IconAction icon="close" label="Cancel" size="base" onClick={onCancel} />
				<h2 className="min-w-0 flex-1 truncate text-base font-[var(--weight-medium)]">Save to documents</h2>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto bg-[var(--sunken)]/40">
				<div className="flex items-start justify-center p-10">
					<div className="w-full max-w-[620px]">
						<h3 className="text-h3">Where should {one ? "this file" : "these files"} go?</h3>
						<p className="mt-1 max-w-[62ch] text-sm text-[var(--ink-muted)]">
							{place && !place.linked
								? `This mail looks like part of ${place.name}. Change it if it is not.`
								: "Choose a client, a project, both or neither. Leave both empty to keep them in Unfiled."}
						</p>
						<ul className="mt-4 flex flex-col gap-1 text-dense text-[var(--ink-muted)]">
							{fileNames.slice(0, 8).map((name, at) => (
								<li key={`${at}:${name}`} className="truncate">
									{name}
								</li>
							))}
							{fileNames.length > 8 ? <li>and {fileNames.length - 8} more</li> : null}
						</ul>
						<div className="mt-6">
							<DocumentOwnerFields value={choice} onChange={setChoice} disabled={busy} />
						</div>
						{offer ? (
							<label className="mt-4 flex cursor-pointer items-center gap-3 text-base">
								<Checkbox checked={link} disabled={busy} onChange={(event) => setLink(event.target.checked)} />
								<span>{LINK_LABELS[offer]}</span>
							</label>
						) : null}
						<div className="mt-6 flex justify-end gap-2">
							<Button onClick={onCancel}>Cancel</Button>
							<Button
								variant="primary"
								disabled={busy}
								onClick={() => onSave(placeOfChoice(choice), offer !== null && link)}
							>
								{busy ? "Saving" : one ? "Save the file" : `Save ${fileNames.length} files`}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
	return host ? createPortal(frame, host) : frame;
}
