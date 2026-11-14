import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DocumentRecord, DocumentTemplate, DocumentVersion, ReferenceItem, VersionUse } from "@shared/types";
import { BelongsToLinks } from "../../components/BelongsToLinks";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { FilePreviewView } from "../../components/FilePreviewView";
import { FullPreview } from "../../components/FullPreview";
import { IconAction } from "../../components/IconAction";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { PdfViewer } from "../../components/PdfViewer";
import { RecordLink } from "../../components/RecordLink";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { fileTypeLabel, isPdfFile } from "../../lib/file-type";
import { modifiedLabel } from "../../lib/modified-label";
import { announceDocumentsChanged, onDocumentsChanged } from "../../lib/pdf-drop";
import { useFilePreview } from "../../lib/use-file-preview";
import { formatBytes } from "../projects/format";
import { convertedSentence } from "./document-flows";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "./DocumentOwnerFields";
import { DocumentTimeline } from "./DocumentTimeline";
import { RenameField } from "./RenameField";
import { SpecimenMark } from "./SpecimenMark";
import { useDocumentHistory } from "./use-document-history";
import { KIND_LABELS } from "./version-format";
import { VersionSwitcher } from "./VersionSwitcher";

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
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

type VersionBodyProps = {
	version: DocumentVersion;
	caption: ReactNode;
	onOpen: () => void;
};

type DocumentDetailProps = {
	documentId: string;
	/** The name the list already shows, drawn while the document is read so the heading does not blink. */
	knownTitle?: string;
	/** Where it sits among the files of the folder it was opened from, for Previous and Next. */
	position: { index: number; total: number; onPrevious: () => void; onNext: () => void } | null;
	/** "Back to Contracts". */
	closeLabel: string;
	onClose: () => void;
	/** Bumped when the document changed outside this view, such as an edit saved in Word. */
	revision: number;
	details: boolean;
	onToggleDetails: () => void;
	onDeleted: (record: DocumentRecord) => void;
	onChanged: () => void;
	/** Signing is a page that takes the screen, so the screen owns it. */
	onSign: (record: DocumentRecord) => void;
	/** So is writing a mail with it attached. */
	onSend: (record: DocumentRecord) => void;
	/** Copy to and Move to ask where, in the screen's own picker. */
	onCopyTo: (record: DocumentRecord) => void;
	onMoveTo: (record: DocumentRecord) => void;
	/** A notice for the screen to show, such as that a conversion may look different. */
	onNotice: (message: string) => void;
	/** The record's own title, for the title bar trail, once it has loaded and after a rename. */
	onTitleChange: (title: string) => void;
};

/**
 * One version of a file as the preview draws it: a PDF in the viewer, which
 * stays the viewer for PDFs (decision 40), and anything else from what the
 * main process made of it (decision 76).
 */
function VersionBody({ version, caption, onOpen }: VersionBodyProps) {
	const pdf = isPdfFile(version.fileName, version.mediaType);
	const state = useFilePreview(pdf ? null : { kind: "version", versionId: version.id });
	if (pdf) {
		return (
			<PdfViewer
				fileKey={version.id}
				read={window.juno.documents.readVersion}
				caption={caption}
				empty={<p className="text-[var(--ink-muted)]">This version has no file.</p>}
			/>
		);
	}
	return <FilePreviewView state={state} onOpen={onOpen} caption={caption} />;
}

/**
 * A document opened from the explorer: the file over the whole content area,
 * with its name, type and size at the top, Previous and Next through the
 * folder, its actions, and a column at the right with what the detail view
 * always had: the details, the client and project it is kept under, the
 * versions to look through and the timeline. The column can be put away.
 *
 * The version on screen is a choice made here and the newest is the default.
 * Sending by email, signing and downloading ask first when it is not the
 * newest (decision 40).
 */
export function DocumentDetail({
	documentId,
	knownTitle,
	position,
	closeLabel,
	onClose,
	revision,
	details,
	onToggleDetails,
	onDeleted,
	onChanged,
	onSign,
	onSend,
	onCopyTo,
	onMoveTo,
	onNotice,
	onTitleChange,
}: DocumentDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [action, setAction] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [renaming, setRenaming] = useState(false);
	// Null follows the newest, so a version that arrives is shown without a click.
	const [viewedId, setViewedId] = useState<string | null>(null);
	const { history, reload: reloadHistory } = useDocumentHistory(documentId);
	// Previous and Next change the document without a new view, so what was about the last one goes.
	const [shownId, setShownId] = useState(documentId);
	if (shownId !== documentId) {
		setShownId(documentId);
		setLoad({ status: "loading" });
		setViewedId(null);
		setRenaming(false);
		setAction(null);
		setConfirmingDelete(false);
	}

	const fetchDetail = useCallback(async (): Promise<Detail | null> => {
		const [record, statusSet] = await Promise.all([
			window.juno.documents.get(documentId),
			window.juno.reference.getSet("document_status"),
		]);
		if (!record) return null;
		const template = record.templateId ? await window.juno.templates.get(record.templateId) : null;
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
				setLoad(detail ? { status: "ready", detail } : { status: "error", message: "It was deleted. Close the preview to go back to the folder." });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchDetail, revision]);

	const refresh = useCallback(() => {
		fetchDetail()
			.then((detail) => {
				if (detail) setLoad({ status: "ready", detail });
			})
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
		reloadHistory();
	}, [fetchDetail, reloadHistory]);

	useEffect(() => {
		if (revision > 0) reloadHistory();
	}, [revision, reloadHistory]);

	const loadedTitle = load.status === "ready" ? load.detail.record.title : null;
	useEffect(() => {
		if (loadedTitle !== null) onTitleChange(loadedTitle);
	}, [loadedTitle, onTitleChange]);

	const versions = history?.versions ?? [];
	const latest = versions[0] ?? null;
	const viewing = versions.find((version) => version.id === viewedId) ?? latest;

	async function run(label: string, work: () => Promise<void>) {
		if (busy) return;
		setBusy(label);
		setAction(null);
		try {
			await work();
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		} finally {
			setBusy(null);
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

	// Any change to the documents reads this one again: a move or a copy made
	// from the explorer behind the preview changes where it is kept.
	useEffect(() => onDocumentsChanged(refresh), [refresh]);

	const changed = () => {
		announceDocumentsChanged();
		onChanged();
	};

	if (load.status !== "ready") {
		return (
			<FullPreview title={knownTitle ?? "Document"} closeLabel={closeLabel} onClose={onClose} position={position}>
				{load.status === "loading" ? (
					<FilePreviewView state={{ status: "loading" }} />
				) : (
					<FilePreviewView state={{ status: "error", message: load.message }} />
				)}
			</FullPreview>
		);
	}

	const { record, statuses, template } = load.detail;
	const templateVersion = record.templateVersion ?? template?.version ?? null;
	const isImported = record.sourceKind === "imported";
	const hasFile = viewing !== null;
	const newestIsPdf = latest ? isPdfFile(latest.fileName, latest.mediaType) : false;
	const canSign = !record.isSpecimen && latest !== null;

	const setStatus = (statusId: string) =>
		void run("status", async () => {
			await window.juno.documents.setStatus(documentId, statusId.length > 0 ? statusId : null);
			refresh();
			onChanged();
		});

	/** Moves it to another client or project, or to neither. The file stays as it is. */
	const relink = (next: DocumentOwnerChoice) =>
		void run("link", async () => {
			await window.juno.documents.link(documentId, { clientId: next.clientId || null, projectId: next.projectId || null });
			changed();
		});

	const renderPdf = () =>
		void run("render", async () => {
			await window.juno.documents.renderPdf(documentId);
			setViewedId(null);
			changed();
		});

	/** A PDF of the newest version, kept as the next one. Juno's own route says the layout may differ. */
	const convert = (then?: (converted: DocumentRecord) => void) =>
		void run("convert", async () => {
			const result = await window.juno.documents.convertPdf(documentId);
			setViewedId(null);
			changed();
			onNotice(convertedSentence(result.via));
			then?.(result.document);
		});

	const openOutside = () =>
		void run("open", async () => {
			if (!viewing || viewing.isLatest) {
				const opened = await window.juno.documents.open(documentId);
				if (opened.readOnly) onNotice("Opened read only, because this version is signed.");
			} else {
				await window.juno.documents.openVersion(viewing.id);
				onNotice(`Version ${viewing.number} opened read only. Edits are made to the newest.`);
			}
		});

	const download = () =>
		void guarded("download", () => {
			if (!viewing) return;
			const number = viewing.number;
			void run("download", async () => {
				const saved = await window.juno.documents.downloadVersion(viewing.id);
				if (saved) onNotice(`Saved a copy of version ${number}.`);
			});
		});

	const deleteVersion = () =>
		void run("version", async () => {
			if (!viewing) return;
			const number = viewing.number;
			if (!(await window.juno.documents.deleteVersion(viewing.id))) return;
			setViewedId(null);
			onNotice(`Deleted version ${number}.`);
			changed();
		});

	const addVersion = () =>
		void run("add", async () => {
			const picked = await window.juno.documents.pickFiles();
			for (const file of picked) {
				await window.juno.documents.addVersion({
					documentId,
					source: { kind: "bytes", fileName: file.fileName, data: file.data, fileDate: file.fileDate, via: "picker" },
				});
			}
			if (picked.length > 0) {
				setViewedId(null);
				changed();
			}
		});

	const duplicate = () =>
		void run("duplicate", async () => {
			const copy = await window.juno.documents.duplicate(documentId);
			onNotice(`Duplicated as ${copy.title}.`);
			announceDocumentsChanged();
			onChanged();
		});

	const rename = (title: string) => {
		setRenaming(false);
		void run("rename", async () => {
			await window.juno.documents.rename(documentId, title);
			changed();
		});
	};

	const remove = () => {
		setConfirmingDelete(false);
		void run("delete", async () => {
			onDeleted(await window.juno.documents.remove(documentId));
		});
	};

	const sign = () => {
		if (newestIsPdf) void guarded("sign", () => onSign(record));
		else convert(onSign);
	};

	const menu: MenuItem[] = [
		{ id: "duplicate", label: "Duplicate", icon: "templates", disabled: !latest, onSelect: duplicate },
		{ id: "copy-to", label: "Copy to", icon: "copy", disabled: !latest, onSelect: () => onCopyTo(record) },
		{ id: "move-to", label: "Move to", icon: "move-right", onSelect: () => onMoveTo(record) },
		{ id: "rename", label: "Rename", icon: "edit", hint: "F2", onSelect: () => setRenaming(true) },
		{ id: "send", label: "Send by mail", icon: "mail", disabled: !hasFile, separatorBefore: true, onSelect: () => void guarded("email", () => onSend(record)) },
		{ id: "add-version", label: "Add a version", icon: "import", onSelect: addVersion },
		{
			id: "delete-version",
			label: "Delete this version",
			icon: "remove",
			disabled: !hasFile || versions.length < 2,
			onSelect: deleteVersion,
		},
		...(!isImported && record.templateId
			? [{ id: "render", label: "Create the PDF again", icon: "sync" as const, onSelect: renderPdf }]
			: []),
		{ id: "delete", label: "Delete", icon: "remove", danger: true, separatorBefore: true, onSelect: () => setConfirmingDelete(true) },
	];

	const caption = viewing ? (
		<span className="flex items-center gap-2">
			<span className="tabular">
				Version {viewing.number} of {versions.length}
			</span>
			<span>{KIND_LABELS[viewing.kind]}</span>
			{viewing.isLatest ? null : (
				<button
					type="button"
					onClick={() => setViewedId(null)}
					className="text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
				>
					View latest
				</button>
			)}
		</span>
	) : null;

	const facts = viewing
		? [fileTypeLabel(viewing.fileName, viewing.mediaType), viewing.byteSize === null ? "" : formatBytes(viewing.byteSize), modifiedLabel(viewing.fileDate)]
				.filter(Boolean)
				.join(" · ")
		: "";
	// The client and the project each open their own record.
	const meta = (
		<>
			{facts ? `${facts} · ` : null}
			<BelongsToLinks clientId={record.clientId} clientName={record.clientName} projectId={record.projectId} projectName={record.projectName} />
		</>
	);

	const column = (
		<div className="flex flex-col gap-2 px-6 pt-2 pb-6">
			{record.isSpecimen ? (
				<p className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					This came from a template nobody had reviewed. The wording is invented, the PDF carries a red banner, and it cannot be
					signed.
				</p>
			) : null}
			<Section title="Details">
				<div className="grid grid-cols-2 gap-4">
					<Select
						label="Status"
						value={record.statusId ?? ""}
						onChange={setStatus}
						placeholder="No status"
						options={statuses.map((item) => ({ value: item.id, label: item.label }))}
					/>
					<Fact label="Issued on">
						<span className="tabular">{formatDate(record.issuedOn) || "Not set"}</span>
					</Fact>
					<div className="col-span-2">
						<DocumentOwnerFields
							value={{ clientId: record.clientId ?? "", projectId: record.projectId ?? "" }}
							onChange={relink}
						/>
					</div>
					{latest ? (
						<div className="col-span-2">
							<Fact label="File">
								<span className="break-all">{latest.fileName ?? record.title}</span>
							</Fact>
						</div>
					) : null}
					{isImported ? (
						<Fact label="Source">Added from a file</Fact>
					) : (
						<>
							<Fact label="Template">
								{template ? (
									<RecordLink
										label={`Open ${template.name}`}
										onOpen={() => requestOpen({ kind: "document-template", id: template.id, name: template.name })}
									>
										{template.name}
									</RecordLink>
								) : (
									"The template has since been removed."
								)}
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
					<Button size="dense" disabled={busy !== null} onClick={addVersion}>
						Add a version
					</Button>
				}
			>
				<VersionSwitcher
					versions={versions}
					viewingId={viewing?.id ?? null}
					onView={(id) => setViewedId(id === latest?.id ? null : id)}
					onOpenCertificate={(id) => void run("certificate", () => window.juno.documents.openCertificate(id))}
				/>
			</Section>

			<Section title="Timeline">
				<DocumentTimeline entries={history?.timeline ?? []} onView={(id) => setViewedId(id === latest?.id ? null : id)} />
			</Section>
		</div>
	);

	return (
		<FullPreview
			title={record.title}
			heading={renaming ? <RenameField value={record.title} onCommit={rename} onCancel={() => setRenaming(false)} /> : undefined}
			badges={
				<>
					{record.isSpecimen ? <SpecimenMark /> : null}
					{viewing && !viewing.isLatest ? (
						<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-2 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--warn)]">
							Not the latest
						</span>
					) : null}
				</>
			}
			meta={meta}
			position={position}
			closeLabel={closeLabel}
			onClose={onClose}
			column={column}
			columnOpen={details}
			onToggleColumn={onToggleDetails}
			actions={
				<>
					<Button size="dense" disabled={!hasFile || busy !== null} onClick={openOutside}>
						Open
					</Button>
					{latest && !newestIsPdf ? (
						<Button size="dense" disabled={busy !== null} onClick={() => convert()}>
							{busy === "convert" ? "Converting" : "Convert to PDF"}
						</Button>
					) : null}
					{canSign ? (
						<Button size="dense" variant="primary" disabled={busy !== null} onClick={sign}>
							{newestIsPdf ? "Sign" : "Convert and sign"}
						</Button>
					) : null}
					<span aria-hidden className="mx-1 h-5 w-px bg-[var(--line)]" />
					<IconAction icon="export" label="Download a copy" disabled={!hasFile} onClick={download} />
					<MenuButton size="dense" ariaLabel="More document actions" items={menu} />
				</>
			}
		>
			<div className="flex h-full min-h-0 flex-col">
				{action ? (
					<p role="alert" data-selectable className="flex-none border-b border-[var(--line)] bg-[var(--risk-soft)] px-4 py-2 text-sm text-[var(--risk)]">
						{action}
					</p>
				) : null}
				<div className="min-h-0 flex-1">
					{viewing ? (
						<VersionBody key={viewing.id} version={viewing} caption={caption} onOpen={openOutside} />
					) : history === null ? (
						<FilePreviewView state={{ status: "loading" }} />
					) : (
						<div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--sunken)] p-8 text-center">
							<p className="text-[var(--ink-muted)]">This document has no file yet.</p>
							{!isImported && record.templateId ? (
								<Button variant="primary" disabled={busy !== null} onClick={renderPdf}>
									{busy === "render" ? "Creating" : "Create PDF"}
								</Button>
							) : null}
						</div>
					)}
				</div>
			</div>

			{confirmingDelete ? (
				<Dialog title="Delete document" width="narrow" onClose={() => setConfirmingDelete(false)}>
					<p className="mt-3 text-base">
						{record.title} is removed{record.clientName ? ` from ${record.clientName}` : ""}. You can undo this straight after.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
						<Button variant="danger" onClick={remove}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</FullPreview>
	);
}

function Section({ title, aside, children }: SectionProps) {
	return (
		<section className="mt-4">
			<div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2">
				<h3 className="text-base font-[var(--weight-medium)]">{title}</h3>
				{aside}
			</div>
			<div className="mt-3">{children}</div>
		</section>
	);
}

function Fact({ label, children }: FactProps) {
	return (
		<div>
			<p className="mb-1 text-sm text-[var(--ink-muted)]">{label}</p>
			<p data-selectable className="text-base">
				{children}
			</p>
		</div>
	);
}
