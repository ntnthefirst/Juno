import { useCallback, useEffect, useState } from "react";
import type { DocumentTimelineEntry, DocumentVersion } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { onDocumentsChanged } from "../../lib/pdf-drop";

type History = {
	/** Newest first. */
	versions: DocumentVersion[];
	/** Newest first. */
	timeline: DocumentTimelineEntry[];
};

/**
 * The versions and the timeline of one document, read together so the two never
 * disagree, and read again whenever something in the window changes the
 * documents. `reload` is for a change this screen made itself, such as an email
 * that was just queued.
 */
export function useDocumentHistory(documentId: string) {
	// Tagged with the document it is of, so the next document in a preview never shows the last one's versions.
	const [held, setHistory] = useState<{ documentId: string; history: History } | null>(null);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(() => {
		Promise.all([window.juno.documents.versions(documentId), window.juno.documents.timeline(documentId)])
			.then(([versions, timeline]) => {
				setHistory({ documentId, history: { versions, timeline } });
				setError(null);
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, [documentId]);

	useEffect(() => {
		reload();
		return onDocumentsChanged(reload);
	}, [reload]);

	const history = held && held.documentId === documentId ? held.history : null;
	return { history, error, reload };
}
