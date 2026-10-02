import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
	DocumentRecord,
	DocumentTemplate,
	ReferenceItem,
	VersionUse,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconAction } from "../../components/IconAction";
import { MenuButton } from "../../components/Menu";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { announceDocumentsChanged } from "../../lib/pdf-drop";
import { ComposePage } from "../mail/ComposePage";
import { DocumentTimeline } from "./DocumentTimeline";
import { PdfViewer } from "../../components/PdfViewer";
import { useDocumentHistory } from "./use-document-history";
import { KIND_LABELS } from "./version-format";
import { VersionSwitcher } from "./VersionSwitcher";

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

export function SpecimenMark() {
	return (
		<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--risk)]">
			Specimen
		</span>
	);
}

function ImportedMark() {
	return (
		<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
			Imported
		</span>
	);
}

type Detail = {
	record: DocumentRecord;
	statuses: ReferenceItem[];
	template: DocumentTemplate | null;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; detail: Detail }
	| { status: "error"; message: string };

type FactProps = {
	label: string;
	children: ReactNode;
};

type SectionProps = {
	title: string;
	/** Drawn at the right of the heading. */
	aside?: ReactNode;
	children: ReactNode;
};

type DocumentDetailProps = {
	documentId: string;
	onDeleted: (record: DocumentRecord) => void;
	onChanged: () => void;
	/** Signing is a page that takes the screen, so the screen owns it. */
	onSign: (record: DocumentRecord) => void;
	/** The screen shows this in the title bar trail. Called with the loaded
	 * record's own title, so a rename elsewhere still reaches the trail rather
	 * than leaving it stuck on whatever label the list row had. */
	onTitleChange: (title: string) => void;
};

/**
 * A document is its PDF, so opening one opens the PDF: the viewer takes the left
 * and everything else about the document sits in a column on the right. The
 * version being looked at is a choice made here, and the newest is the default.
 * Sending by email, signing and downloading ask first when it is not the newest.
 */
export function DocumentDetail({
	documentId,
	onDeleted,
	onChanged,
	onSign,
	onTitleChange,
}: DocumentDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [action, setAction] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [sending, setSending] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	// Null follows the newest, so a version that arrives is shown without a click.
	const [viewedId, setViewedId] = useState<string | null>(null);
	const { history, reload: reloadHistory } = useDocumentHistory(documentId);

	const fetchDetail = useCallback(async (): Promise<Detail | null> => {
		const [record, statusSet] = await Promise.all([
			window.juno.documents.get(documentId),
			window.juno.reference.getSet("document_status"),
		]);
		if (!record) return null;
		const template = record.templateId
			? await window.juno.templates.get(record.templateId)
			: null;
		return {
			record,
			statuses: statusSet ? statusSet.items.filter((item) => item.hiddenAt === null) : [],
			template,
		};
	}, [documentId]);

	useEffect(() => {
		let cancelled = false;
		fetchDetail()
			.then((detail) => {
				if (cancelled) return;
				setLoad(
					detail
						? { status: "ready", detail }
						: { status: "error", message: "This document is no longer in your juno." },
				);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchDetail]);

	const refresh = useCallback(() => {
		fetchDetail()
			.then((detail) => {
				if (detail) setLoad({ status: "ready", detail });
			})
			.catch((cause: unknown) => {
				setLoad({ status: "error", message: messageOf(cause) });
			});
		reloadHistory();
	}, [fetchDetail, reloadHistory]);

	const loadedTitle = load.status === "ready" ? load.detail.record.title : null;
	useEffect(() => {
		if (loadedTitle !== null) onTitleChange(loadedTitle);
	}, [loadedTitle, onTitleChange]);

	const versions = history?.versions ?? [];
	const latest = versions[0] ?? null;
	const viewing = versions.find((version) => version.id === viewedId) ?? latest;

	async function setStatus(statusId: string) {
		setAction(null);
		try {
			await window.juno.documents.setStatus(documentId, statusId.length > 0 ? statusId : null);
			refresh();
			onChanged();
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		}
	}

	async function renderPdf() {
		if (busy) return;
		setBusy(true);
		setAction(null);
		try {
			await window.juno.documents.renderPdf(documentId);
			setViewedId(null);
			refresh();
			onChanged();
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function run(work: () => Promise<void>) {
		setAction(null);
		try {
			await work();
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		}
	}

	/** Goes on when the version on screen is the newest, or when the person says so. */
	async function guarded(use: VersionUse, go: () => void) {
		if (!viewing) return;
		setAction(null);
		try {
			if (await window.juno.documents.confirmVersionUse(viewing.id, use)) go();
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		}
	}

	async function download() {
		if (!viewing) return;
		const number = viewing.number;
		await run(async () => {
			const saved = await window.juno.documents.downloadVersion(viewing.id);
			if (saved) setNotice(`Saved a copy of version ${number}.`);
		});
	}

	async function deleteVersion() {
		if (!viewing) return;
		const number = viewing.number;
		await run(async () => {
			if (!(await window.juno.documents.deleteVersion(viewing.id))) return;
			setViewedId(null);
			setNotice(`Deleted version ${number}.`);
			announceDocumentsChanged();
			refresh();
			onChanged();
		});
	}

	async function addVersion() {
		setAction(null);
		try {
			const picked = await window.juno.documents.pickPdfs();
			for (const file of picked) {
				await window.juno.documents.addVersion({
					documentId,
					source: { kind: "bytes", fileName: file.fileName, data: file.data, fileDate: file.fileDate, via: "picker" },
				});
			}
			if (picked.length > 0) {
				announceDocumentsChanged();
				refresh();
				onChanged();
			}
		} catch (cause: unknown) {
			setAction(messageOf(cause));
			refresh();
		}
	}

	async function remove() {
		setConfirmingDelete(false);
		try {
			onDeleted(await window.juno.documents.remove(documentId));
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		}
	}

	if (load.status === "loading") return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="m-8 border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">
					Could not load this document.
				</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { record, statuses, template } = load.detail;
	const templateVersion = record.templateVersion ?? template?.version ?? null;
	// An imported PDF has no body and no template behind it, so nothing here may
	// offer an action the service would reject: no re-render.
	const isImported = record.sourceKind === "imported";
	const hasFile = viewing !== null;

	const caption = viewing ? (
		<span className="flex items-center gap-2">
			<span className="tabular">
				Version {viewing.number} of {versions.length}
			</span>
			<span>{KIND_LABELS[viewing.kind]}</span>
			{viewing.isLatest ? null : (
				<>
					<span className="rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--warn)]">
						Not the latest
					</span>
					<button
						type="button"
						onClick={() => setViewedId(null)}
						className="text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
					>
						View latest
					</button>
				</>
			)}
		</span>
	) : null;

	return (
		<div className="flex h-full min-h-0">
			<div className="min-w-0 flex-1">
				<PdfViewer
					fileKey={viewing?.id ?? null}
					read={window.juno.documents.readVersion}
					caption={caption}
					empty={
						history === null ? (
							<p className="text-[var(--ink-muted)]">Loading.</p>
						) : (
							<div>
								<p className="text-[var(--ink-muted)]">This document has no PDF yet.</p>
								{!isImported ? (
									<div className="mt-3">
										<Button variant="primary" disabled={busy} onClick={() => void renderPdf()}>
											{busy ? "Creating" : "Create PDF"}
										</Button>
									</div>
								) : null}
							</div>
						)
					}
				/>
			</div>

			<aside
				aria-label="Document"
				className="flex h-full w-[380px] shrink-0 flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)]"
			>
				<div className="px-5 pt-5">
					<div className="flex flex-wrap items-center gap-2">
						<h2
							data-selectable
							className="min-w-0 break-words text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]"
						>
							{record.title}
						</h2>
						{record.isSpecimen ? <SpecimenMark /> : null}
						{isImported ? <ImportedMark /> : null}
					</div>
					<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{record.clientName}</p>

					<div className="mt-4 flex items-center gap-1">
						<Button variant="primary" disabled={!hasFile} onClick={() => void guarded("sign", () => onSign(record))}>
							Sign
						</Button>
						<div className="ml-auto flex items-center gap-1">
							<IconAction
								size="base"
								icon="mail"
								label="Send by email"
								disabled={!hasFile}
								onClick={() => void guarded("email", () => setSending(true))}
							/>
							<IconAction
								size="base"
								icon="export"
								label="Download a copy"
								disabled={!hasFile}
								onClick={() => void guarded("download", () => void download())}
							/>
							<IconAction
								size="base"
								icon="external"
								label="Open outside Juno"
								disabled={!hasFile}
								onClick={() => viewing && void run(() => window.juno.documents.openVersion(viewing.id))}
							/>
							<IconAction
								size="base"
								icon="folder-open"
								label="Show in folder"
								disabled={!hasFile}
								onClick={() => viewing && void run(() => window.juno.documents.revealVersion(viewing.id))}
							/>
							<IconAction
									size="base"
									icon="remove"
									label="Delete this version"
									disabled={!hasFile || versions.length < 2}
									onClick={() => void deleteVersion()}
								/>
								<MenuButton
								size="base"
								ariaLabel="More document actions"
								items={[
									...(!isImported
										? [
												{
													id: "render",
													label: busy ? "Creating" : "Create the PDF again",
													icon: "sync" as const,
													disabled: busy,
													onSelect: () => void renderPdf(),
												},
											]
										: []),
									{
										id: "delete",
										label: "Delete",
										icon: "remove" as const,
										danger: true,
										separatorBefore: !isImported,
										onSelect: () => setConfirmingDelete(true),
									},
								]}
							/>
						</div>
					</div>
				</div>

				{record.isSpecimen ? (
					<p className="mx-5 mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						This came from a template nobody had reviewed. The wording is invented, the PDF carries a
						red banner, and it cannot be signed.
					</p>
				) : null}

				{action ? (
					<p
						role="alert"
						data-selectable
						className="mx-5 mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
					>
						{action}
					</p>
				) : null}
				{notice ? (
					<p role="status" className="mx-5 mt-4 border-l-2 border-[var(--ok)] pl-3 text-[length:var(--text-sm)] text-[var(--ok)]">
						{notice}
					</p>
				) : null}

				<div className="mt-2 flex flex-col gap-2 px-5 pb-6">
					<Section title="Details">
						<div className="grid grid-cols-2 gap-4">
							<Select
								label="Status"
								value={record.statusId ?? ""}
								onChange={(value) => void setStatus(value)}
								placeholder="No status"
								options={statuses.map((item) => ({ value: item.id, label: item.label }))}
							/>
							<Fact label="Issued on">
								<span className="tabular">{formatDate(record.issuedOn) || "Not set"}</span>
							</Fact>
							{isImported ? (
								<Fact label="Source">Imported PDF</Fact>
							) : (
								<>
									<Fact label="Template">
										{template ? template.name : "The template has since been removed."}
									</Fact>
									<Fact label="Template version">
										<span className="tabular">{templateVersion === null ? "Unknown" : templateVersion}</span>
									</Fact>
								</>
							)}
						</div>
					</Section>

					<Section
						title={`Versions ${record.versionCount}`}
						aside={
							<Button size="dense" onClick={() => void addVersion()}>
								Add a version
							</Button>
						}
					>
						<p className="mb-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Pick one to read it here. Sending and signing use the latest.
						</p>
						<VersionSwitcher
							versions={versions}
							viewingId={viewing?.id ?? null}
							onView={(id) => setViewedId(id === latest?.id ? null : id)}
							onOpenCertificate={(id) => void run(() => window.juno.documents.openCertificate(id))}
						/>
					</Section>

					<Section title="Timeline">
						<DocumentTimeline
							entries={history?.timeline ?? []}
							onView={(id) => setViewedId(id === latest?.id ? null : id)}
						/>
					</Section>
				</div>
			</aside>

			{sending ? (
				<ComposePage
					seed={{
						clientId: record.clientId,
						projectId: record.projectId,
						documentIds: [record.id],
						subject: record.title,
					}}
					onClose={() => setSending(false)}
					onDeleted={() => {
						setSending(false);
						setNotice("Draft deleted.");
					}}
					onDone={(_message, queued) => {
						setSending(false);
						setNotice(queued ? "Message queued. Follow it in the mail outbox." : "Draft saved in the mail outbox.");
						reloadHistory();
					}}
				/>
			) : null}

			{confirmingDelete ? (
				<Dialog title="Delete document" width="narrow" onClose={() => setConfirmingDelete(false)}>
					<p className="mt-3 text-[length:var(--text-base)]">
						{record.title} is removed from {record.clientName}. You can undo this straight after.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
						<Button variant="danger" onClick={() => void remove()}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}

function Section({ title, aside, children }: SectionProps) {
	return (
		<section className="mt-4">
			<div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2">
				<h3 className="text-[length:var(--text-base)] font-[var(--weight-medium)]">{title}</h3>
				{aside}
			</div>
			<div className="mt-3">{children}</div>
		</section>
	);
}

function Fact({ label, children }: FactProps) {
	return (
		<div>
			<p className="mb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{label}</p>
			<p data-selectable className="text-[length:var(--text-base)]">
				{children}
			</p>
		</div>
	);
}
