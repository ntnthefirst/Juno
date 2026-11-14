import { useEffect, useState } from "react";
import type { DocumentRecord } from "@shared/types";
import { usePublishBreadcrumb, type Crumb } from "../../app/breadcrumb-context";
import { PreviewSkeleton } from "../../components/PreviewSkeleton";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { announceDocumentsChanged } from "../../lib/pdf-drop";
import { useRecentTouch } from "../../lib/use-recent-touch";
import { DocumentDetail } from "./DocumentDetail";
import { DocumentTakeover } from "./DocumentTakeover";
import { convertToPdf, needsConversion } from "./document-flows";
import { placeKeyOf } from "./place-options";
import { RecordPickerDialog } from "./RecordPickerDialog";
import { takeoverLabel, type DocumentTakeoverRequest } from "./takeover";

type DocumentCoverProps = {
	documentId: string;
	/** What the way back is called: the record or the screen the preview was asked for from. */
	label: string;
	/** Back to that screen, as it was. */
	onReturn: () => void;
};

type Load = { status: "loading" } | { status: "ready"; record: DocumentRecord } | { status: "error"; message: string };

/**
 * One document asked for from another screen (a timeline, Recent, the
 * palette, the Agent screen, Mail), drawn over it in a second sheet while that
 * screen is kept underneath (decision 75). A file is previewed and a page
 * opens to write in; signing and sending take the sheet the way they take a
 * record's. Closing, Escape and the way back in the title bar return to the
 * screen it was asked for from, with its tab, its scroll and its row.
 */
export function DocumentCover({ documentId, label, onReturn }: DocumentCoverProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [title, setTitle] = useState<string | null>(null);
	const [takeover, setTakeover] = useState<DocumentTakeoverRequest | null>(null);
	const [picker, setPicker] = useState<{ mode: "copy" | "move"; record: DocumentRecord } | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [details, setDetails] = useState(true);
	const [revision, setRevision] = useState(0);

	useRecentTouch("document", documentId);

	useEffect(() => {
		let cancelled = false;
		window.juno.documents
			.get(documentId)
			.then((record) => {
				if (cancelled) return;
				if (!record) {
					setLoad({ status: "error", message: "That document was deleted." });
					return;
				}
				setLoad({ status: "ready", record });
				setTitle(record.title);
				if (record.sourceKind === "page") setTakeover({ kind: "page", record });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [documentId]);

	// An edit saved in another app comes back as a version, and the preview reads it again.
	useEffect(
		() =>
			window.juno.documents.onChanged((change) => {
				if (change.documentIds.includes(documentId)) setRevision(Date.now());
			}),
		[documentId],
	);

	const page = takeover?.kind === "page";
	const crumbs: Crumb[] = [{ label, onSelect: onReturn }];
	if (takeover && !page) {
		crumbs.push({ label: title ?? "Document", onSelect: () => setTakeover(null) }, { label: takeoverLabel(takeover) });
	} else {
		crumbs.push({ label: title ?? "Document" });
	}
	usePublishBreadcrumb(crumbs);

	async function signFrom(record: DocumentRecord) {
		if (!needsConversion(record)) {
			setTakeover({ kind: "sign", record });
			return;
		}
		try {
			const done = await convertToPdf(record);
			setNotice(done.notice);
			setTakeover({ kind: "sign", record: done.record });
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function copyOrMove(mode: "copy" | "move", record: DocumentRecord, target: { clientId: string | null; projectId: string | null; name: string }) {
		setPicker(null);
		try {
			const into = { clientId: target.clientId, projectId: target.projectId };
			if (mode === "copy") await window.juno.documents.copyTo(record.id, into);
			else await window.juno.documents.move(record.id, into);
			announceDocumentsChanged();
			setRevision(Date.now());
			setNotice(`${record.title} ${mode === "copy" ? "copied" : "moved"} to ${target.name}.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	if (takeover) {
		return (
			<DocumentTakeover
				request={takeover}
				onTitleChange={setTitle}
				onClose={(sentence, gone) => {
					// A page has nothing under it here: closing it is closing the cover.
					if (page || gone) {
						if (gone) announceDocumentsChanged();
						onReturn();
						return;
					}
					setTakeover(null);
					setRevision(Date.now());
					if (sentence) setNotice(sentence);
				}}
			/>
		);
	}

	return (
		<div className="relative h-full min-h-0">
			{load.status === "loading" ? (
				<div className="h-full p-6">
					<PreviewSkeleton />
				</div>
			) : null}
			{load.status === "error" ? (
				<div role="alert" className="animate-fade m-8 border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not open this document.</p>
					<p data-selectable className="mt-1 max-w-[62ch] text-sm text-[var(--ink-muted)]">
						{load.message}
					</p>
				</div>
			) : null}
			{load.status === "ready" && load.record.sourceKind !== "page" ? (
				<DocumentDetail
					documentId={documentId}
					knownTitle={title ?? load.record.title}
					position={null}
					closeLabel={`Back to ${label}`}
					onClose={onReturn}
					revision={revision}
					details={details}
					onToggleDetails={() => setDetails((value) => !value)}
					onDeleted={() => {
						announceDocumentsChanged();
						onReturn();
					}}
					onChanged={() => announceDocumentsChanged()}
					onSign={(record) => void signFrom(record)}
					onSend={(record) => setTakeover({ kind: "send", record })}
					onCopyTo={(record) => setPicker({ mode: "copy", record })}
					onMoveTo={(record) => setPicker({ mode: "move", record })}
					onNotice={setNotice}
					onTitleChange={setTitle}
				/>
			) : null}
			{picker ? (
				<RecordPickerDialog
					title={`${picker.mode === "copy" ? "Copy" : "Move"} ${picker.record.title}`}
					confirmLabel={picker.mode === "copy" ? "Copy here" : "Move here"}
					current={picker.mode === "move" ? placeKeyOf(picker.record) : null}
					onClose={() => setPicker(null)}
					onPick={(target) => void copyOrMove(picker.mode, picker.record, target)}
				/>
			) : null}
			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</div>
	);
}
