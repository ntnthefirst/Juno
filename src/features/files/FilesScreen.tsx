import { useCallback, useState } from "react";
import type { DocumentRecord } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { TitleSearch } from "../../app/TitleSearch";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { announceDocumentsChanged } from "../../lib/pdf-drop";
import { useScreenAction } from "../../lib/screen-actions";
import { DocumentTakeover } from "../documents/DocumentTakeover";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { takeoverLabel, type DocumentTakeoverRequest } from "../documents/takeover";

/**
 * The seventh place (decision 82): the owner's own files, the ones that
 * belong to no client and no project. A spreadsheet, the terms and
 * conditions, a logo, a checklist page. It is a client's Documents tab with
 * no client: the same list, the same keys, and New, Add files and a paste
 * keep what they make here.
 */
export function FilesScreen() {
	const [takeover, setTakeover] = useState<DocumentTakeoverRequest | null>(null);
	const [deleted, setDeleted] = useState<DocumentRecord | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [version, setVersion] = useState(0);
	const [search, setSearch] = useState("");

	usePublishBreadcrumb(
		takeover ? [{ label: "Files", onSelect: () => setTakeover(null) }, { label: takeoverLabel(takeover) }] : [{ label: "Files" }],
	);

	// New in the title bar, Ctrl N and the palette make a page here and open it.
	const newPage = useCallback(async () => {
		try {
			const page = await window.juno.pages.create({ clientId: null, projectId: null });
			announceDocumentsChanged();
			setTakeover({ kind: "page", record: page.document });
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}, []);
	useScreenAction("files", (action) => {
		if (action === "new") void newPage();
	});

	if (takeover) {
		return (
			<DocumentTakeover
				request={takeover}
				onTitleChange={(title) =>
					setTakeover((current) => (current && current.record.title !== title ? { ...current, record: { ...current.record, title } } : current))
				}
				onClose={(sentence, gone) => {
					setTakeover(null);
					setVersion((value) => value + 1);
					if (gone) setDeleted(gone);
					else if (sentence) setNotice(sentence);
				}}
			/>
		);
	}

	return (
		<div className="relative h-full overflow-y-auto">
			<TitleSearch value={search} onChange={setSearch} placeholder="Search files" />
			<div className="flex w-full flex-col p-8">
				<DocumentsPanel
					key={version}
					scope={{ files: true }}
					name="Files"
					search={search}
					onChanged={() => undefined}
					onTakeOver={setTakeover}
				/>
			</div>
			{deleted ? (
				<Toast
					message={`${deleted.title} deleted.`}
					actionLabel="Undo"
					onAction={() => {
						const back = deleted;
						setDeleted(null);
						void window.juno.documents
							.restore(back.id)
							.then(() => setVersion((value) => value + 1))
							.catch((cause: unknown) => setNotice(messageOf(cause)));
					}}
					onDismiss={() => setDeleted(null)}
				/>
			) : notice ? (
				<Toast message={notice} onDismiss={() => setNotice(null)} />
			) : null}
		</div>
	);
}
