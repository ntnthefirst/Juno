import { useMemo, useState } from "react";
import type { DocumentRecord } from "@shared/types";
import { Button } from "../../components/Button";
import { CardHeader } from "../../components/CardHeader";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { Icon } from "../../components/Icon";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { announceDocumentsChanged } from "../../lib/pdf-drop";
import type { Loaded } from "../../lib/use-loaded";
import { typeOf, documentItem } from "../documents/explorer-items";
import { RecordPickerDialog } from "../documents/RecordPickerDialog";
import { unfiledOf } from "./unfiled";

const SHOWN = 5;

type UnfiledCardProps = {
	documents: Loaded<DocumentRecord[]>;
	/** The documents were read again elsewhere once one was given a place. */
	onChanged: () => void;
};

/**
 * The files kept under no client and no project (decision 81). Nothing makes
 * one any more, but an older install, an agent or a mail attachment saved
 * before may have, and without a place a file is on no Documents tab. Each
 * row is given one here, and See all lists the rest the way a tab does.
 * The card is not drawn at all while there are none.
 */
export function UnfiledCard({ documents, onChanged }: UnfiledCardProps) {
	const [placing, setPlacing] = useState<DocumentRecord | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const unfiled = useMemo(() => (documents.status === "ready" ? unfiledOf(documents.value) : []), [documents]);

	if (unfiled.length === 0) return notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null;

	async function place(record: DocumentRecord, target: { clientId: string | null; projectId: string | null; name: string }) {
		setPlacing(null);
		try {
			await window.juno.documents.move(record.id, { clientId: target.clientId, projectId: target.projectId });
			announceDocumentsChanged();
			setNotice(`${record.title} moved to ${target.name}.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
		onChanged();
	}

	return (
		<section aria-label="Files without a client">
			<CardHeader
				title="Files without a client"
				count={unfiled.length}
				link={{ label: "See all", onClick: () => requestOpen({ kind: "screen", screen: "unfiled" }) }}
			/>
			<p className="mb-1 text-sm text-ink-muted">Give each one a client or a project, so it is on that record's Documents tab.</p>
			<ul className="flex flex-col">
				{unfiled.slice(0, SHOWN).map((record) => (
					<li key={record.id} className="flex min-h-12 items-center gap-3 py-2">
						<span className="flex w-7 flex-none justify-center">
							{record.latestVersion ? (
								<FileTypeIcon filename={record.latestVersion.fileName ?? record.title} mimeType={record.latestVersion.mediaType} size={24} />
							) : (
								<span className="text-accent">
									<Icon name="note" size={20} />
								</span>
							)}
						</span>
						<button
							type="button"
							onClick={() => requestOpen({ kind: "document", id: record.id, name: record.title })}
							className="min-w-0 flex-1 rounded-[var(--radius-sm)] text-left transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
						>
							<span className="block truncate text-base">{record.title}</span>
							<span className="block truncate text-sm text-ink-muted">{typeOf(documentItem(record))}</span>
						</button>
						<Button size="dense" onClick={() => setPlacing(record)}>
							<span className="whitespace-nowrap">Pick a place</span>
						</Button>
					</li>
				))}
			</ul>
			{placing ? (
				<RecordPickerDialog
					title={`Move ${placing.title}`}
					confirmLabel="Move here"
					current={null}
					onClose={() => setPlacing(null)}
					onPick={(target) => void place(placing, target)}
				/>
			) : null}
			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</section>
	);
}
