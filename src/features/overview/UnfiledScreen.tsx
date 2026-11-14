import { useState } from "react";
import type { DocumentRecord } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { DocumentTakeover } from "../documents/DocumentTakeover";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { takeoverLabel, type DocumentTakeoverRequest } from "../documents/takeover";

/**
 * Every file kept under no client and no project, reached from See all on the
 * Overview card and lit under Overview. The list behaves as a Documents tab
 * does, and Move to gives a file its client or project, after which it is on
 * that record's tab and gone from here.
 */
export function UnfiledScreen() {
	const [takeover, setTakeover] = useState<DocumentTakeoverRequest | null>(null);
	const [deleted, setDeleted] = useState<DocumentRecord | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [version, setVersion] = useState(0);

	const toOverview = () => requestOpen({ kind: "screen", screen: "overview" });
	usePublishBreadcrumb(
		takeover
			? [
					{ label: "Overview", onSelect: toOverview },
					{ label: "Files without a client", onSelect: () => setTakeover(null) },
					{ label: takeoverLabel(takeover) },
				]
			: [{ label: "Overview", onSelect: toOverview }, { label: "Files without a client" }],
	);

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
			<div className="flex w-full flex-col gap-3 p-6">
				<p className="max-w-[62ch] text-base text-ink-muted">
					These files are kept under no client and no project, so they are on no Documents tab. Right-click one and choose Move to, to
					give it one.
				</p>
				<DocumentsPanel key={version} scope={{ unfiled: true }} name="Files without a client" onChanged={() => undefined} onTakeOver={setTakeover} />
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
