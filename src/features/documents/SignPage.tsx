import { useEffect, useMemo, useRef, useState } from "react";
import { ownerDisplayName } from "@shared/owner";
import { clampPlacement, stampMetrics, STAMP_DEFAULT_WIDTH } from "@shared/stamp";
import type { DocumentRecord, SigningCertificateInfo, StampPlacement } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { SplitButton } from "../../components/SplitButton";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { openPdf, type PDFDocumentProxy } from "../../lib/pdf";
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

const MAX_PAGE_WIDTH = 760;

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
 * Signing is the PDF itself with the stamp already on it. Drag the stamp to
 * where it goes, drag its corner to size it, double-click it to change the
 * name, and sign. The chevron beside Sign adds a digital signature made with the
 * certificate from Settings, which is the one a PDF reader can verify.
 *
 * The stamp signs the newest version, and signing adds a new one, so nothing
 * that was there before is touched.
 */
export function SignPage({ record, onClose, onSigned }: SignPageProps) {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [signerName, setSignerName] = useState("");
	const [showDetails, setShowDetails] = useState(true);
	const [placement, setPlacement] = useState<StampPlacement | null>(null);
	const [asking, setAsking] = useState<"passphrase" | "certificate" | null>(null);
	const [passphrase, setPassphrase] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [pageWidth, setPageWidth] = useState(0);
	const column = useRef<HTMLDivElement>(null);
	const openedAt = useMemo(() => new Date(), []);

	useEffect(() => {
		if (record.isSpecimen) return;
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
				const view = (await pdf.getPage(number)).getViewport({ scale: 1 });
				aspects.push(view.height / view.width);
			}
			const image = imageUrl ? await measureImage(imageUrl) : null;
			if (cancelled) return;
			setSignerName(ownerDisplayName(owner));
			setLoaded({ pdf, aspects, image, certificate });
			// Bottom left of the last page, where a signature usually goes.
			const last = aspects.length;
			const height = stampMetrics(STAMP_DEFAULT_WIDTH, image ? image.aspect : null).height / aspects[last - 1]!;
			setPlacement({ page: last, x: 0.08, y: Math.max(0, 1 - height - 0.07), width: STAMP_DEFAULT_WIDTH });
		})().catch((cause: unknown) => {
			if (!cancelled) setError(messageOf(cause));
		});
		return () => {
			cancelled = true;
			void opened?.loadingTask.destroy();
		};
	}, [record.id, record.isSpecimen]);

	// A certificate imported in Settings while this page is open counts straight
	// away. Settings is a modal window with no channel back except this one.
	useEffect(
		() =>
			window.juno.window.onChildClosed(() => {
				void window.juno.signingCertificate.get().then((certificate) => {
					setLoaded((current) => (current ? { ...current, certificate } : current));
				});
			}),
		[],
	);

	useEffect(() => {
		const element = column.current;
		if (!element) return;
		const measure = () => setPageWidth(Math.min(MAX_PAGE_WIDTH, Math.floor(element.clientWidth - 32)));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [loaded]);

	const image = loaded?.image ?? null;
	// Without an image the name and the date are all the stamp has, so they stay.
	const details = showDetails || image === null;

	/** The stamp changes height, so it is kept on the page when it grows. */
	function changeDetails(next: boolean) {
		setShowDetails(next);
		if (!loaded || !placement) return;
		setPlacement(
			clampPlacement(placement, image ? image.aspect : null, loaded.aspects[placement.page - 1]!, next),
		);
	}

	// The stamp starts on the last page, which is usually below the fold.
	const stampPage = placement?.page ?? null;
	const shown = useRef(false);
	useEffect(() => {
		if (shown.current || stampPage === null || pageWidth <= 0) return;
		const stamp = column.current?.querySelector("[data-stamp]");
		if (!stamp) return;
		shown.current = true;
		stamp.scrollIntoView({ block: "center" });
	}, [stampPage, pageWidth]);

	function moveTo(page: number, fraction: { x: number; y: number }) {
		if (!loaded || !placement) return;
		const aspect = loaded.aspects[page - 1]!;
		const height = stampMetrics(placement.width, image ? image.aspect : null, details).height / aspect;
		// Centred on the click, then kept on the page.
		setPlacement(
			clampPlacement(
				{ page, width: placement.width, x: fraction.x - placement.width / 2, y: fraction.y - height / 2 },
				image ? image.aspect : null,
				aspect,
				details,
			),
		);
	}

	async function sign(digital: boolean) {
		if (busy || !placement) return;
		const name = signerName.trim();
		if (!name) {
			setError("The stamp has no name. Double-click it on the stamp to fill one in.");
			return;
		}
		setError(null);
		setBusy(true);
		try {
			await window.juno.documents.sign({
				documentId: record.id,
				signerName: name,
				signerRole: null,
				useSignatureImage: image !== null,
				showDetails: details,
				placement,
				digital: digital ? { passphrase } : null,
			});
			setPassphrase("");
			onSigned();
		} catch (cause: unknown) {
			setPassphrase("");
			setAsking(null);
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	function signDigitally() {
		setError(null);
		setAsking(loaded?.certificate ? "passphrase" : "certificate");
	}

	if (record.isSpecimen) {
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

	const pages = loaded ? Array.from({ length: loaded.pdf.numPages }, (_, index) => index + 1) : [];

	return (
		<FormPage
			title={`Sign ${record.title}`}
			onBack={onClose}
			width="wide"
			actions={
				<>
					{error ? (
						<p data-selectable className="mr-auto min-w-0 truncate text-[length:var(--text-sm)] text-[var(--risk)]" title={error}>
							{error}
						</p>
					) : null}
					<Button onClick={onClose}>Cancel</Button>
					<SplitButton
						label={busy ? "Signing" : "Sign"}
						disabled={busy || !placement}
						onClick={() => void sign(false)}
						menuLabel="More ways to sign"
						items={[
							{
								id: "digital",
								label: "Sign digitally",
								icon: "edit",
								hint: loaded?.certificate ? undefined : "Set up first",
								onSelect: signDigitally,
							},
						]}
					/>
				</>
			}
		>
			<p className="mb-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Drag the stamp where it goes and its corner to size it. Double-click the stamp to change the name.
			</p>
			<div className="mb-3 max-w-md">
				<Toggle
					checked={details}
					disabled={image === null}
					onChange={changeDetails}
					label="Name and time under the stamp"
					description={
						image === null
							? "Needed while there is no signature image to stamp."
							: "Turn off to stamp the signature image alone. They stay in the certificate."
					}
				/>
			</div>
			<div ref={column} className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] bg-[var(--sunken)] p-4">
				{!loaded ? (
					<p className="py-8 text-[var(--ink-muted)]">{error ? "" : "Opening the PDF."}</p>
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
											name={signerName}
											dateText={stampDate(openedAt)}
											showDetails={details}
											onChange={setPlacement}
											onNameChange={setSignerName}
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

			{asking === "passphrase" && loaded?.certificate ? (
				<Dialog title="Sign digitally" width="narrow" onClose={() => setAsking(null)}>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void sign(true);
						}}
					>
						<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							The stamp is added and the file is sealed with the certificate of{" "}
							{loaded.certificate.subject}, valid until {loaded.certificate.validTo.slice(0, 10)}.
						</p>
						<div className="mt-4">
							<Field
								label="Certificate passphrase"
								type="password"
								value={passphrase}
								onChange={setPassphrase}
								help="Leave it empty when the certificate has none. It is not kept."
							/>
						</div>
						<div className="mt-6 flex justify-end gap-2">
							<Button onClick={() => setAsking(null)}>Cancel</Button>
							<Button type="submit" variant="primary" disabled={busy}>
								{busy ? "Signing" : "Sign digitally"}
							</Button>
						</div>
					</form>
				</Dialog>
			) : null}

			{asking === "certificate" ? (
				<Dialog title="No certificate yet" width="narrow" onClose={() => setAsking(null)}>
					<p className="mt-3 text-[length:var(--text-base)]">
						A digital signature is made with your own certificate. Import the .p12 or .pfx file under
						Settings, then sign again.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setAsking(null)}>Cancel</Button>
						<Button
							variant="primary"
							onClick={() => {
								setAsking(null);
								void window.juno.window.openSettings("documents");
							}}
						>
							Open settings
						</Button>
					</div>
				</Dialog>
			) : null}
		</FormPage>
	);
}
