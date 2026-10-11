import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { FormPage, type FormStep } from "../../components/FormPage";
import { PdfViewer } from "../../components/PdfViewer";
import { TemplateInputFields } from "../../components/TemplateInputFields";
import { messageOf } from "../../lib/errors";
import { belongsTo } from "../documents/belongs-to";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "../documents/DocumentOwnerFields";

type UseCanvasTemplateScreenProps = {
	template: DocumentTemplate;
	onBack: () => void;
	/** Called when the person is finished, so the caller can decide where to go. */
	onDone: () => void;
};

type StepKey = "fill" | "pdf" | "keep";

type Printed = { stamp: number; pdf: Uint8Array; missing: string[] };

type Created = { title: string; isSpecimen: boolean; pdfError: string | null; where: string };

/**
 * Using a template laid out on paper: fill it in, see the PDF, then decide
 * where it is kept.
 *
 * A canvas template takes nothing from a client (docs/templates.md), so the PDF
 * exists before anyone is chosen, and choosing a client, a project, both or
 * neither only decides where the document is kept. The question is asked the
 * moment the PDF is made, as a question with two answers, and the answer that
 * needs fields opens a step of its own rather than a form in a dialog
 * (decision 30). A PDF that is not kept can be saved anywhere as a file.
 */
export function UseCanvasTemplateScreen({ template, onBack, onDone }: UseCanvasTemplateScreenProps) {
	const [stepIndex, setStepIndex] = useState(0);
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(template.inputs.filter((input) => input.defaultValue).map((input) => [input.key, input.defaultValue ?? ""])),
	);
	const [attemptedFill, setAttemptedFill] = useState(false);
	const [printed, setPrinted] = useState<Printed | null>(null);
	const [printing, setPrinting] = useState(false);
	const [asking, setAsking] = useState(false);
	const [owner, setOwner] = useState<DocumentOwnerChoice>({ clientId: "", projectId: "" });
	const [title, setTitle] = useState(template.name);
	const [created, setCreated] = useState<Created | null>(null);
	const [savedTo, setSavedTo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// The viewer reads its file by key; the bytes are already in hand.
	const read = useCallback(async () => printed?.pdf ?? new Uint8Array(), [printed]);

	const hasInputs = template.inputs.length > 0;
	const steps: StepKey[] = hasInputs ? ["fill", "pdf", "keep"] : ["pdf", "keep"];
	const step = steps[Math.min(stepIndex, steps.length - 1)]!;
	const formSteps: FormStep[] = steps.map((key) =>
		key === "fill"
			? { label: "Fill", hint: "Everything this document says that changes each time." }
			: key === "pdf"
				? { label: "PDF", hint: "The document as it prints." }
				: { label: "Keep", hint: "Where it is kept: a client, a project, both or neither." },
	);
	const missingRequired = template.inputs.filter(
		(input) => input.required && (values[input.key] ?? "").trim().length === 0,
	);

	async function print(): Promise<void> {
		setPrinting(true);
		setError(null);
		try {
			const result = await window.juno.templates.renderPdf({ templateId: template.id, values });
			setPrinted({ stamp: Date.now(), pdf: result.pdf, missing: result.missing });
			setAsking(true);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setPrinting(false);
		}
	}

	// A template that asks for nothing goes straight to its PDF.
	const printedOnce = useRef(false);
	useEffect(() => {
		if (hasInputs || printedOnce.current) return;
		printedOnce.current = true;
		void print();
		// Printed once, on arrival; `print` reads the values in hand.
	});

	function goTo(next: StepKey): void {
		setStepIndex(steps.indexOf(next));
	}

	function goNext(): void {
		if (step === "fill") {
			setAttemptedFill(true);
			if (missingRequired.length > 0) return;
			goTo("pdf");
			void print();
		}
	}

	function goBack(): void {
		if (stepIndex === 0) {
			onBack();
			return;
		}
		setStepIndex((index) => Math.max(index - 1, 0));
	}

	async function savePdf(): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			const path = await window.juno.templates.savePdf({ templateId: template.id, values });
			if (path) setSavedTo(path);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function create(): Promise<void> {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await window.juno.documents.generate({
				clientId: owner.clientId || null,
				templateId: template.id,
				projectId: owner.projectId || null,
				title: title.trim() || template.name,
				extras: values,
			});
			setCreated({
				title: result.document.title,
				isSpecimen: result.document.isSpecimen,
				pdfError: result.pdfError,
				where: belongsTo(result.document),
			});
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	if (created) {
		return (
			<FormPage title={`Use: ${template.name}`} onBack={onDone} backLabel="Done" width="form">
				<p className="text-[length:var(--text-h3)] font-[var(--weight-semibold)]">Document created</p>
				<p className="mt-3 text-[length:var(--text-base)]">
					{created.pdfError === null
						? created.where === "Not linked"
							? `${created.title} is kept in Juno as a PDF, under no client or project.`
							: `${created.title} is kept with ${created.where} as a PDF.`
						: `${created.title} was saved, but its PDF was not written.`}
					{created.isSpecimen ? " It is marked as a specimen, because the template has not been reviewed." : ""}
				</p>
				{created.pdfError !== null ? (
					<p className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						{created.pdfError} The document is in the list, so create its PDF from there.
					</p>
				) : null}
				<div className="mt-6">
					<Button variant="primary" onClick={onDone}>
						Done
					</Button>
				</div>
			</FormPage>
		);
	}

	return (
		<FormPage
			title={`Use: ${template.name}`}
			onBack={goBack}
			backLabel={stepIndex === 0 ? "Back" : "Previous"}
			steps={formSteps}
			step={stepIndex}
			onStep={setStepIndex}
			width={step === "pdf" ? "wide" : "form"}
			actions={
				<>
					<Button onClick={goBack}>{stepIndex === 0 ? "Cancel" : "Previous"}</Button>
					{step === "fill" ? (
						<Button variant="primary" onClick={goNext}>
							Make the PDF
						</Button>
					) : step === "pdf" ? (
						<>
							<Button disabled={busy || !printed} onClick={() => void savePdf()}>
								Save PDF
							</Button>
							<Button variant="primary" disabled={!printed} onClick={() => goTo("keep")}>
								Keep in Juno
							</Button>
						</>
					) : (
						<Button variant="primary" disabled={busy} onClick={() => void create()}>
							{busy ? "Creating" : "Create document"}
						</Button>
					)}
				</>
			}
		>
			{error ? (
				<p
					role="alert"
					data-selectable
					className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			{step === "fill" ? (
				<TemplateInputFields
					inputs={template.inputs}
					values={values}
					onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
					missing={attemptedFill ? missingRequired.map((input) => input.key) : []}
					pictureFiles
				/>
			) : null}

			{step === "pdf" ? (
				<div className="flex h-[min(70vh,760px)] min-h-[420px] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)]">
					<PdfViewer
						fileKey={printed ? String(printed.stamp) : null}
						read={read}
						caption={
							printed && printed.missing.length > 0 ? (
								<span className="truncate text-[length:var(--text-micro)] text-[var(--risk)]">
									No value for: {printed.missing.join(", ")}
								</span>
							) : savedTo ? (
								<span className="truncate text-[length:var(--text-micro)] text-[var(--ok)]">Saved to {savedTo}</span>
							) : null
						}
						empty={
							<p className="p-6 text-center text-[var(--ink-muted)]">{printing ? "Making the PDF." : "No PDF yet."}</p>
						}
					/>
				</div>
			) : null}

			{step === "keep" ? (
				<div className="flex flex-col gap-4">
					<DocumentOwnerFields value={owner} onChange={setOwner} disabled={busy} />
					<Field label="Title" value={title} onChange={setTitle} help="How the document is listed." />
					<p className="max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						The PDF is the one you saw. Nothing from a client or project is written into it. A document from a template
						nobody has reviewed is marked as a specimen and cannot be signed.
					</p>
				</div>
			) : null}

			{asking && printed ? (
				<Dialog title="Keep this document" onClose={() => setAsking(false)} width="narrow">
					<p className="text-[length:var(--text-dense)]">
						The PDF is made. Keep it in Juno, under a client, a project or neither?
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setAsking(false)}>Not now</Button>
						<Button
							variant="primary"
							onClick={() => {
								setAsking(false);
								goTo("keep");
							}}
						>
							Keep in Juno
						</Button>
					</div>
				</Dialog>
			) : null}
		</FormPage>
	);
}
