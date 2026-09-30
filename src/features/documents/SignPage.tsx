import { useEffect, useMemo, useRef, useState } from "react";
import { ownerDisplayName } from "@shared/owner";
import { clampPlacement, stampMetrics, STAMP_DEFAULT_WIDTH, STAMP_MAX_WIDTH, STAMP_MIN_WIDTH } from "@shared/stamp";
import type { DocumentRecord, SigningCertificateInfo, StampPlacement } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { openPdf, type PDFDocumentProxy } from "../../lib/pdf";
import { SpecimenMark } from "./DocumentDetail";
import { PdfPageView } from "./PdfPageView";
import { StampBox } from "./StampBox";

type SignPageProps = {
	record: DocumentRecord;
	onClose: () => void;
	onSigned: () => void;
};

type Loaded = {
	pdf: PDFDocumentProxy;
	aspects: number[];
	image: { url: string; aspect: number } | null;
	certificate: SigningCertificateInfo | null;
};

const MAX_PAGE_WIDTH = 720;

/** The same wording the PDF gets, so the preview does not differ from the file. */
function stampDate(now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `Ondertekend op ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} om ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function measureImage(url: string): Promise<{ url: string; aspect: number } | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve({ url, aspect: image.naturalHeight / image.naturalWidth });
		image.onerror = () => resolve(null);
		image.src = url;
	});
}

/**
 * Signing is a page, not a dialog: it opens the PDF itself, and the stamp is
 * placed on it by dragging. Clicking a page puts the stamp there, dragging moves
 * it and the corner resizes it. The fractions it reports are turned into
 * coordinates in the main process, which is also where the file is written.
 */
export function SignPage({ record, onClose, onSigned }: SignPageProps) {
	const specimen = record.isSpecimen;
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [signerName, setSignerName] = useState("");
	const [signerRole, setSignerRole] = useState("");
	const [useImage, setUseImage] = useState(true);
	const [placement, setPlacement] = useState<StampPlacement | null>(null);
	const [digital, setDigital] = useState(false);
	const [passphrase, setPassphrase] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const [passphraseError, setPassphraseError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [pageWidth, setPageWidth] = useState(0);
	const column = useRef<HTMLDivElement>(null);
	const openedAt = useMemo(() => new Date(), []);

	useEffect(() => {
		if (specimen) return;
		let cancelled = false;
		let opened: PDFDocumentProxy | null = null;
		(async () => {
			const [bytes, owner, imageUrl, certificate] = await Promise.all([
				window.juno.documents.readPdf(record.id),
				window.juno.settings.getOwner(),
				window.juno.settings.getSignatureImage(),
				window.juno.signingCertificate.get(),
			]);
			const pdf = await openPdf(bytes);
			opened = pdf;
			const aspects: number[] = [];
			for (let number = 1; number <= pdf.numPages; number += 1) {
				const page = await pdf.getPage(number);
				const view = page.getViewport({ scale: 1 });
				aspects.push(view.height / view.width);
			}
			const image = imageUrl ? await measureImage(imageUrl) : null;
			if (cancelled) return;
			setSignerName(ownerDisplayName(owner));
			setUseImage(image !== null);
			setLoaded({ pdf, aspects, image, certificate });
			// Bottom left of the last page, where a signature usually goes.
			const last = aspects.length;
			const width = STAMP_DEFAULT_WIDTH;
			const height = stampMetrics(width, image ? image.aspect : null).height / aspects[last - 1]!;
			setPlacement({ page: last, x: 0.08, y: Math.max(0, 1 - height - 0.07), width });
		})().catch((cause: unknown) => {
			if (!cancelled) setError(messageOf(cause));
		});
		return () => {
			cancelled = true;
			void opened?.loadingTask.destroy();
		};
	}, [record.id, specimen]);

	useEffect(() => {
		const element = column.current;
		if (!element) return;
		const measure = () => setPageWidth(Math.min(MAX_PAGE_WIDTH, Math.floor(element.clientWidth - 32)));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [loaded]);

	const image = loaded && useImage ? loaded.image : null;

	function moveTo(page: number, fraction: { x: number; y: number }) {
		if (!loaded || !placement) return;
		const aspect = loaded.aspects[page - 1]!;
		const height = stampMetrics(placement.width, image ? image.aspect : null).height / aspect;
		// Centred on the click, then kept on the page.
		setPlacement(
			clampPlacement(
				{ page, width: placement.width, x: fraction.x - placement.width / 2, y: fraction.y - height / 2 },
				image ? image.aspect : null,
				aspect,
			),
		);
	}

	function resize(width: number) {
		if (!loaded || !placement) return;
		setPlacement(
			clampPlacement({ ...placement, width }, image ? image.aspect : null, loaded.aspects[placement.page - 1]!),
		);
	}

	async function sign() {
		if (busy || !placement) return;
		const name = signerName.trim();
		setNameError(name.length === 0 ? "Enter the name of the person signing." : null);
		setPassphraseError(digital && passphrase.length === 0 ? "Enter the certificate passphrase." : null);
		if (name.length === 0 || (digital && passphrase.length === 0)) return;

		setError(null);
		setBusy(true);
		try {
			await window.juno.documents.sign({
				documentId: record.id,
				signerName: name,
				signerRole: signerRole.trim() || null,
				useSignatureImage: image !== null,
				placement,
				digital: digital ? { passphrase } : null,
			});
			setPassphrase("");
			onSigned();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setPassphrase("");
			setBusy(false);
		}
	}

	if (specimen) {
		return (
			<FormPage title="Sign document" onBack={onClose} actions={<Button onClick={onClose}>Close</Button>}>
				<p className="text-[length:var(--text-base)]">
					This document cannot be signed. It was generated from a template nobody has reviewed, so
					its text is a specimen and signing it would put a signature on wording that was never
					checked.
				</p>
				<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Review the template under Templates, generate the document again, and sign that one.
				</p>
			</FormPage>
		);
	}

	const certificate = loaded?.certificate ?? null;
	const pages = loaded ? Array.from({ length: loaded.pdf.numPages }, (_, index) => index + 1) : [];

	return (
		<FormPage
			title="Sign document"
			onBack={onClose}
			width="wide"
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button variant="primary" disabled={busy || !placement} onClick={() => void sign()}>
						{busy ? "Signing" : digital ? "Stamp and sign digitally" : "Stamp"}
					</Button>
				</>
			}
		>
			<div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6">
				<div>
					<p className="mb-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Click a page to put the stamp there. Drag it to move it and drag its corner to resize
						it.
					</p>
					<div
						ref={column}
						className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] bg-[var(--sunken)] p-4"
					>
						{!loaded ? (
							<p className="text-[var(--ink-muted)]">{error ? "" : "Opening the PDF."}</p>
						) : (
							pages.map((number) => {
								const aspect = loaded.aspects[number - 1]!;
								return (
									<div key={number} className="flex flex-col items-start gap-1">
										<PdfPageView
											pdf={loaded.pdf}
											pageNumber={number}
											width={pageWidth}
											aspect={aspect}
											onPlace={(fraction) => moveTo(number, fraction)}
										>
											{placement && placement.page === number ? (
												<StampBox
													placement={placement}
													pageWidth={pageWidth}
													pageHeight={pageWidth * aspect}
													image={image}
													name={
														signerRole.trim() ? `${signerName}, ${signerRole.trim()}` : signerName
													}
													dateText={stampDate(openedAt)}
													onChange={setPlacement}
												/>
											) : null}
										</PdfPageView>
										<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											Page {number} of {loaded.pdf.numPages}
										</span>
									</div>
								);
							})
						)}
					</div>
				</div>

				<aside className="sticky top-0 flex flex-col gap-4">
					{error ? (
						<div className="border-l-2 border-[var(--risk)] pl-4">
							<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not sign this document.</p>
							<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{error}
							</p>
						</div>
					) : null}
					<div className="rounded-[var(--radius-sm)] bg-[var(--sunken)] px-3 py-2">
						<div className="flex items-center gap-2">
							<p data-selectable className="truncate font-[var(--weight-medium)]">
								{record.title}
							</p>
							{record.isSpecimen ? <SpecimenMark /> : null}
						</div>
						<p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{record.clientName}
						</p>
					</div>

					<Field label="Signed by" required value={signerName} onChange={setSignerName} error={nameError} />
					<Field label="Role" value={signerRole} onChange={setSignerRole} placeholder="Optional" />

					<div>
						<label htmlFor="stamp-size" className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Stamp size
						</label>
						<input
							id="stamp-size"
							type="range"
							min={STAMP_MIN_WIDTH}
							max={STAMP_MAX_WIDTH}
							step={0.01}
							value={placement?.width ?? STAMP_DEFAULT_WIDTH}
							onChange={(event) => resize(Number(event.target.value))}
							className="w-full accent-[var(--accent)]"
						/>
					</div>

					<div>
						<label className="flex items-center gap-3 text-[length:var(--text-base)]">
							<input
								type="checkbox"
								checked={image !== null}
								disabled={!loaded?.image}
								onChange={(event) => setUseImage(event.target.checked)}
								className="h-4 w-4 accent-[var(--accent)]"
							/>
							Include the signature image
						</label>
						{loaded && !loaded.image ? (
							<p className="mt-1 pl-7 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								No signature image is set. Choose one under Settings, or stamp without it.
							</p>
						) : null}
					</div>

					<div className="border-t border-[var(--line)] pt-4">
						<Toggle
							label="Also sign digitally"
							description={
								certificate
									? `With the certificate issued to ${certificate.subject}, valid until ${certificate.validTo.slice(0, 10)}.`
									: "Import a certificate under Settings > Documents to turn this on."
							}
							checked={digital && certificate !== null}
							disabled={certificate === null}
							onChange={setDigital}
						/>
						{digital && certificate ? (
							<div className="mt-3">
								<Field
									label="Certificate passphrase"
									type="password"
									value={passphrase}
									onChange={setPassphrase}
									error={passphraseError}
									help="Asked every time. It is not kept."
								/>
							</div>
						) : null}
					</div>

					<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Signing records the name, the time and a SHA-256 hash of the PDF. A digital signature
						is made with your certificate and shows in a PDF reader whether the file changed. Neither
						is a qualified electronic signature under eIDAS.
					</p>

				</aside>
			</div>
		</FormPage>
	);
}
