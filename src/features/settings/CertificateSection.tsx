import { useEffect, useState } from "react";
import type { SigningCertificateInfo } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

type Load = { status: "loading" } | { status: "ready"; info: SigningCertificateInfo | null };

function day(iso: string): string {
	return iso.slice(0, 10);
}

export function CertificateSection() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [passphrase, setPassphrase] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.signingCertificate
			.get()
			.then((info) => {
				if (!cancelled) setLoad({ status: "ready", info });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function choose() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const info = await window.juno.signingCertificate.choose(passphrase);
			// A cancelled picker returns null and changes nothing.
			if (info) setLoad({ status: "ready", info });
			// The field is cleared whatever happened. The passphrase is only ever
			// typed in to be checked, never shown again.
			setPassphrase("");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.signingCertificate.remove();
			setLoad({ status: "ready", info: null });
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const info = load.status === "ready" ? load.info : null;

	return (
		<Section
			title="Digital signature"
			description="A certificate that signs the PDF itself, so a reader can see who signed and whether it changed."
			action={
				info ? (
					<Button size="dense" variant="danger" disabled={busy} onClick={() => void remove()}>
						Remove
					</Button>
				) : undefined
			}
		>
			{load.status === "loading" ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : info ? (
				<dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1 text-[length:var(--text-dense)]">
					<dt className="text-[var(--ink-muted)]">Issued to</dt>
					<dd data-selectable>{info.subject}</dd>
					<dt className="text-[var(--ink-muted)]">Issued by</dt>
					<dd data-selectable>{info.issuer}</dd>
					<dt className="text-[var(--ink-muted)]">Valid until</dt>
					<dd data-selectable className="tabular">
						{day(info.validTo)}
					</dd>
					<dt className="text-[var(--ink-muted)]">Fingerprint</dt>
					<dd data-selectable className="break-all font-[var(--font-mono)] text-[length:var(--text-sm)]">
						{info.fingerprint}
					</dd>
				</dl>
			) : (
				<div className="flex max-w-[420px] flex-col gap-3">
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						Import the .p12 or .pfx file your certificate authority gave you. Enter its passphrase
						first, then choose the file.
					</p>
					<Field
						label="Certificate passphrase"
						type="password"
						value={passphrase}
						onChange={setPassphrase}
					/>
					<div>
						<Button disabled={busy || passphrase.length === 0} onClick={() => void choose()}>
							Choose certificate
						</Button>
					</div>
				</div>
			)}

			<p className="mt-4 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				The file is kept in the operating system keychain. The passphrase is not kept: you enter it
				each time you sign. A signature made this way is only as trustworthy as the certificate
				behind it, and it is not a qualified electronic signature under eIDAS.
			</p>

			<SectionError message={error} />
		</Section>
	);
}
