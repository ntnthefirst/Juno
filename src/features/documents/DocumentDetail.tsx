import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
	DocumentRecord,
	DocumentSignature,
	DocumentTemplate,
	ReferenceItem,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { ComposeDialog } from "../mail/ComposeDialog";
import { DocumentPreview } from "./DocumentPreview";
import { SignDialog } from "./SignDialog";

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

function formatWhen(iso: string): string {
	return new Intl.DateTimeFormat("nl-BE", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(iso));
}

/** Enough of the hash to compare two by eye, without a line of forty hex digits. */
function shortHash(hash: string): string {
	return hash.slice(0, 12);
}

export function SpecimenMark() {
	return (
		<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--risk)]">
			Specimen
		</span>
	);
}

type Detail = {
	record: DocumentRecord;
	statuses: ReferenceItem[];
	template: DocumentTemplate | null;
	signatures: DocumentSignature[];
};

type Load =
	| { status: "loading" }
	| { status: "ready"; detail: Detail }
	| { status: "error"; message: string };

type FactProps = {
	label: string;
	children: ReactNode;
};

type DocumentDetailProps = {
	documentId: string;
	onDeleted: (record: DocumentRecord) => void;
	onChanged: () => void;
};

export function DocumentDetail({ documentId, onDeleted, onChanged }: DocumentDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [action, setAction] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	const [signing, setSigning] = useState(false);
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const fetchDetail = useCallback(async (): Promise<Detail | null> => {
		const [record, statusSet, signatures] = await Promise.all([
			window.juno.documents.get(documentId),
			window.juno.reference.getSet("document_status"),
			window.juno.documents.signatures(documentId),
		]);
		if (!record) return null;
		const template = record.templateId
			? await window.juno.templates.get(record.templateId)
			: null;
		return {
			record,
			statuses: statusSet ? statusSet.items.filter((item) => item.hiddenAt === null) : [],
			template,
			signatures,
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
	}, [fetchDetail]);

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

	async function remove() {
		setConfirmingDelete(false);
		try {
			onDeleted(await window.juno.documents.remove(documentId));
		} catch (cause: unknown) {
			setAction(messageOf(cause));
		}
	}

	if (load.status === "loading") return <p className="text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">
					Could not load this document.
				</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { record, statuses, template, signatures } = load.detail;
	const hasPdf = record.pdfPath !== null;
	const version = record.templateVersion ?? template?.version ?? null;

	return (
		<div>
			<div className="min-w-0">
				<div className="flex items-center gap-3">
					<h2
						data-selectable
						className="min-w-0 truncate text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]"
					>
						{record.title}
					</h2>
					{record.isSpecimen ? <SpecimenMark /> : null}
				</div>
				<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{record.clientName}
				</p>
			</div>

			{record.isSpecimen ? (
				<p className="mt-4 max-w-[62ch] border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					This came from a template nobody had reviewed. The wording is invented, the PDF carries a
					red banner, and it cannot be signed.
				</p>
			) : null}

			<div className="mt-6 flex flex-wrap gap-2">
				<Button onClick={() => setPreviewing(true)}>Preview</Button>
				<Button disabled={busy} onClick={() => void renderPdf()}>
					{busy ? "Creating" : "Create PDF"}
				</Button>
				<Button
					disabled={!hasPdf}
					onClick={() => void run(() => window.juno.documents.openPdf(documentId))}
				>
					Open PDF
				</Button>
				<Button
					disabled={!hasPdf}
					onClick={() => void run(() => window.juno.documents.revealPdf(documentId))}
				>
					Show in folder
				</Button>
				<Button onClick={() => setSigning(true)}>Sign</Button>
				<Button onClick={() => setSending(true)}>Send by email</Button>
				<Button variant="danger" onClick={() => setConfirmingDelete(true)}>
					Delete
				</Button>
			</div>

			{action ? (
				<p
					role="alert"
					data-selectable
					className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{action}
				</p>
			) : null}
			{sent ? (
				<p role="status" className="mt-4 border-l-2 border-[var(--ok)] pl-3 text-[length:var(--text-sm)] text-[var(--ok)]">
					{sent}
				</p>
			) : null}

			<section className="mt-10">
				<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
					Details
				</h3>
				<div className="mt-4 grid max-w-[520px] grid-cols-2 gap-4">
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
					<Fact label="Template">
						{template ? template.name : "The template has since been removed."}
					</Fact>
					<Fact label="Version">
						<span className="tabular">{version === null ? "Unknown" : version}</span>
					</Fact>
				</div>
			</section>

			<section className="mt-10">
				<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
					Signatures
				</h3>
				{signatures.length === 0 ? (
					<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						Not signed yet.
					</p>
				) : (
					<ul className="mt-2 max-w-[620px]">
						{signatures.map((signature) => (
							<li
								key={signature.id}
								className="border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
							>
								<div className="flex items-baseline justify-between gap-4">
									<span data-selectable className="truncate font-[var(--weight-medium)]">
										{signature.signerName}
										{signature.signerRole ? (
											<span className="font-[var(--weight-normal)] text-[var(--ink-muted)]">
												{"  ·  "}
												{signature.signerRole}
											</span>
										) : null}
									</span>
									<span className="tabular shrink-0 text-[var(--ink-muted)]">
										{formatWhen(signature.signedAt)}
									</span>
								</div>
								<p
									data-selectable
									className="mt-0.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
									style={{ fontFamily: "var(--font-mono)" }}
								>
									{shortHash(signature.documentHash)}
								</p>
							</li>
						))}
					</ul>
				)}
			</section>

			{previewing ? (
				<DocumentPreview
					documentId={record.id}
					title={record.title}
					isSpecimen={record.isSpecimen}
					onClose={() => setPreviewing(false)}
				/>
			) : null}

			{signing ? (
				<SignDialog
					record={record}
					onClose={() => setSigning(false)}
					onSigned={() => {
						setSigning(false);
						refresh();
						onChanged();
					}}
				/>
			) : null}

			{sending ? (
				<ComposeDialog
					seed={{
						clientId: record.clientId,
						projectId: record.projectId,
						documentIds: [record.id],
						templateKey: "contract_cover",
					}}
					onClose={() => setSending(false)}
					onDone={(_message, queued) => {
						setSending(false);
						setSent(queued ? "Message queued. Follow it in the mail outbox." : "Draft saved in the mail outbox.");
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
