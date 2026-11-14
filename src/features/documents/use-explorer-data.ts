import { useCallback, useEffect, useState } from "react";
import type { DocumentRecord, DocumentTree, ReferenceItem } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { useRecordsChanged } from "../../lib/new-record";
import { onDocumentsChanged } from "../../lib/pdf-drop";
import { findNode, ROOT_KEY, TEMPLATES_KEY } from "./explorer-tree";

export type TreeLoad =
	| { status: "loading" }
	| { status: "ready"; tree: DocumentTree }
	| { status: "error"; message: string };

type Contents = { key: string; records: DocumentRecord[] };

export type ExplorerData = {
	tree: TreeLoad;
	/** What is directly in the open node, or null while it is read. The root and Templates hold no documents. */
	records: DocumentRecord[] | null;
	/** Every document, read only while a search is typed. */
	everything: DocumentRecord[] | null;
	/** Why every document could not be read for a search, until the next read. */
	searchError: string | null;
	statuses: ReferenceItem[];
	reload: () => void;
	/** Bumped for each document an edit outside Juno changed, so an open preview reads it again. */
	changedOutside: { ids: string[]; at: number };
};

/**
 * What the explorer draws, read from the services and read again whenever the
 * documents change: by a drop or an import in this window, by a new client or
 * project made in the small window, or in another app, when the main process
 * says a working copy came back as a version (decision 75).
 */
export function useExplorerData(openKey: string, searching: boolean): ExplorerData {
	const [tree, setTree] = useState<TreeLoad>({ status: "loading" });
	const [contents, setContents] = useState<Contents | null>(null);
	const [everything, setEverything] = useState<DocumentRecord[] | null>(null);
	// Kept with the read it belongs to, so a retry shows the skeleton again rather than the old failure.
	const [searchFailure, setSearchFailure] = useState<{ stamp: number; message: string } | null>(null);
	const [statuses, setStatuses] = useState<ReferenceItem[]>([]);
	const [changedOutside, setChangedOutside] = useState<{ ids: string[]; at: number }>({ ids: [], at: 0 });
	const [stamp, setStamp] = useState(0);

	const reload = useCallback(() => setStamp((value) => value + 1), []);

	useEffect(() => {
		let cancelled = false;
		window.juno.reference
			.getSet("document_status")
			.then((set) => {
				if (!cancelled) setStatuses(set ? set.items : []);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [stamp]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const read = await window.juno.documents.folders.tree();
			if (cancelled) return;
			setTree({ status: "ready", tree: read });
			const key = openKey;
			const node = key === ROOT_KEY || key === TEMPLATES_KEY ? null : findNode(read.roots, key);
			if (!node?.place) {
				setContents({ key, records: [] });
				return;
			}
			const records = await window.juno.documents.listIn(node.place);
			if (!cancelled) setContents({ key, records });
		})().catch((cause: unknown) => {
			if (!cancelled) setTree({ status: "error", message: messageOf(cause) });
		});
		return () => {
			cancelled = true;
		};
	}, [stamp, openKey]);

	useEffect(() => {
		if (!searching) return;
		let cancelled = false;
		window.juno.documents
			.list()
			.then((records) => {
				if (cancelled) return;
				setEverything(records);
				setSearchFailure(null);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setSearchFailure({ stamp, message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [searching, stamp]);

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

	return {
		tree,
		records: contents && contents.key === openKey ? contents.records : null,
		everything: searching ? everything : null,
		searchError: searching && searchFailure && searchFailure.stamp === stamp ? searchFailure.message : null,
		statuses,
		reload,
		changedOutside,
	};
}
