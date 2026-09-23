import { useEffect, useState } from "react";
import { ownerDisplayName } from "@shared/owner";
import type { DocumentRecord } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { SpecimenMark } from "./DocumentDetail";

type SignDialogProps = {
	record: DocumentRecord;
	onClose: () => void;
	onSigned: () => void;
};

export function SignDialog({ record, onClose, onSigned }: SignDialogProps) {
	const [signerName, setSignerName] = useState("");
	const [signerRole, setSignerRole] = useState("");
	const [signaturePath, setSignaturePath] = useState<string | null>(null);
	const [useImage, setUseImage] = useState(false);
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const specimen = record.isSpecimen;

	useEffect(() => {
		if (specimen) return;
		let cancelled = false;
		Promise.all([window.juno.settings.getOwner(), window.juno.settings.getSignaturePath()])
			.then(([owner, path]) => {
				if (cancelled) return;
				setSignerName(ownerDisplayName(owner));
				setSignaturePath(path);
				setUseImage(path !== null);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [specimen]);

	async function openPdf() {
		setError(null);
		try {
			await window.juno.documents.openPdf(record.id);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	async function sign() {
		if (busy) return;
		const name = signerName.trim();
		setNameError(name.length === 0 ? "Enter the name of the person signing." : null);
		if (name.length === 0) return;

		setError(null);
		setBusy(true);
		try {
			await window.juno.documents.sign({
				documentId: record.id,
				signerName: name,
				signerRole: signerRole.trim() || null,
				useSignatureImage: signaturePath !== null && useImage,
			});
			onSigned();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	if (specimen) {
		return (
			<Dialog title="Sign document" width="narrow" onClose={onClose}>
				<p className="mt-3 text-[length:var(--text-base)]">
					This document cannot be signed. It was generated from a template nobody has reviewed,
					so its text is a specimen and signing it would put a signature on wording that was never
					checked.
				</p>
				<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Review the template under Templates, generate the document again, and sign that one.
				</p>
				<div className="mt-6 flex justify-end">
					<Button onClick={onClose}>Close</Button>
				</div>
			</Dialog>
		);
	}

	return (
		<Dialog title="Sign document" onClose={onClose}>
			<div className="mt-3 flex items-start justify-between gap-4 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-3 py-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<p
							data-selectable
							className="truncate text-[length:var(--text-base)] font-[var(--weight-medium)]"
						>
							{record.title}
						</p>
						{record.isSpecimen ? <SpecimenMark /> : null}
					</div>
					<p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{record.clientName}
					</p>
				</div>
				<Button disabled={record.pdfPath === null} onClick={() => void openPdf()}>
					Open the PDF
				</Button>
			</div>
			{record.pdfPath === null ? (
				<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					There is no PDF yet. Create one, or sign now and Juno makes one from the current text.
				</p>
			) : null}

			<div className="mt-5 flex flex-col gap-4">
				<Field
					label="Signed by"
					required
					value={signerName}
					onChange={setSignerName}
					error={nameError}
				/>
				<Field label="Role" value={signerRole} onChange={setSignerRole} placeholder="Optional" />

				<div>
					<label className="flex items-center gap-3 text-[length:var(--text-base)]">
						<input
							type="checkbox"
							checked={signaturePath !== null && useImage}
							disabled={signaturePath === null}
							onChange={(event) => setUseImage(event.target.checked)}
							className="h-4 w-4 accent-[var(--accent)]"
						/>
						Stamp the signature image onto the PDF
					</label>
					{signaturePath === null ? (
						<p className="mt-1 pl-7 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							No signature image is set. Choose one under Settings, or sign without it.
						</p>
					) : null}
				</div>
			</div>

			<p className="mt-5 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Signing records the name, the time and a SHA-256 hash of the exact PDF bytes. This is not a
				qualified electronic signature under eIDAS. Anything where that distinction matters should
				go through a provider that offers one.
			</p>

			{error ? (
				<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">
						Could not sign this document.
					</p>
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{error}
					</p>
				</div>
			) : null}

			<div className="mt-6 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="primary" disabled={busy} onClick={() => void sign()}>
					{busy ? "Signing" : "Sign"}
				</Button>
			</div>
		</Dialog>
	);
}
