import { useCallback, useEffect, useState } from "react";
import type { DocumentRecord, ReferenceItem } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { useRecordsChanged } from "../../lib/new-record";
import { onDocumentsChanged } from "../../lib/pdf-drop";

/** Whose documents: a client's (with its projects'), a project's, or the Files place, those kept under neither. */
export type DocumentsScope = { clientId: string } | { projectId: string } | { files: true };

export type RecordDocumentsLoad =
	| { status: "loading" }
	| { status: "ready"; records: DocumentRecord[]; statuses: ReferenceItem[] }
	| { status: "error"; message: string };

export type RecordDocuments = {
	load: RecordDocumentsLoad;
	reload: () => void;
	/** Bumped for each document an edit outside Juno changed, so an open preview reads it again. */
	changedOutside: { ids: string[]; at: number };
};

function read(scope: DocumentsScope): Promise<DocumentRecord[]> {
	if ("files" in scope) return window.juno.documents.listUnfiled();
	if ("clientId" in scope) return window.juno.documents.list({ clientId: scope.clientId });
	return window.juno.documents.list({ projectId: scope.projectId });
}

/**
 * The documents a Documents tab draws, read again whenever they change: by a
 * drop or an import in this window, by a new client or project made in the
 * small window, or in another app, when the main process says a working copy
 * came back as a version (decision 75).
 */
export function useRecordDocuments(scope: DocumentsScope): RecordDocuments {
	const [load, setLoad] = useState<RecordDocumentsLoad>({ status: "loading" });
	const [changedOutside, setChangedOutside] = useState<{ ids: string[]; at: number }>({ ids: [], at: 0 });
	const [stamp, setStamp] = useState(0);
	const key = "files" in scope ? "files" : "clientId" in scope ? `client:${scope.clientId}` : `project:${scope.projectId}`;

	const reload = useCallback(() => setStamp((value) => value + 1), []);

	useEffect(() => {
		let cancelled = false;
		const wanted: DocumentsScope =
			key === "files" ? { files: true } : key.startsWith("client:") ? { clientId: key.slice(7) } : { projectId: key.slice(8) };
		Promise.all([read(wanted), window.juno.reference.getSet("document_status")])
			.then(([records, set]) => {
				if (!cancelled) setLoad({ status: "ready", records, statuses: set ? set.items : [] });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [key, stamp]);

	useEffect(() => onDocumentsChanged(reload), [reload]);
	useRecordsChanged(reload);
	useEffect(
		() =>
			window.juno.documents.onChanged((change) => {
				reload();
				setChangedOutside({ ids: change.documentIds, at: Date.now() });
			}),
		[reload],
	);

	return { load, reload, changedOutside };
}
