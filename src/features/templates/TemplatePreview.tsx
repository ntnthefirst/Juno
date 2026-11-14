import { useCallback, useEffect, useState } from "react";
import type { DocumentTemplate } from "@shared/types";
import { paperLabel, pagesOf } from "@shared/paper";
import { Button } from "../../components/Button";
import { FullPreview } from "../../components/FullPreview";
import { MenuButton } from "../../components/Menu";
import { PdfViewer } from "../../components/PdfViewer";
import { PreviewSkeleton } from "../../components/PreviewSkeleton";
import { messageOf } from "../../lib/errors";
import { modifiedLabel } from "../../lib/modified-label";

type TemplatePreviewProps = {
	templateId: string;
	position: { index: number; total: number; onPrevious: () => void; onNext: () => void } | null;
	details: boolean;
	onToggleDetails: () => void;
	onClose: () => void;
	onEdit: (template: DocumentTemplate) => void;
	onUse: (template: DocumentTemplate) => void;
	onDelete: (template: DocumentTemplate) => void;
};

type Shown =
	| { status: "loading" }
	| { status: "pdf"; stamp: number; pdf: Uint8Array; missing: string[] }
	| { status: "html"; html: string; missing: string[] }
	| { status: "error"; message: string };

/**
 * A document template in the Templates folder, previewed the way a file is: a
 * template on paper as the PDF it prints as, an older one in a frame with an
 * empty sandbox, since its body quotes client data. Edit opens the editor it
 * always had and Use makes a document from it (decision 75).
 */
export function TemplatePreview({ templateId, position, details, onToggleDetails, onClose, onEdit, onUse, onDelete }: TemplatePreviewProps) {
	const [template, setTemplate] = useState<DocumentTemplate | null>(null);
	const [shown, setShown] = useState<Shown>({ status: "loading" });
	const [stale, setStale] = useState(templateId);

	// A new template on screen starts from its loading state, set while rendering rather than in an effect.
	if (stale !== templateId) {
		setStale(templateId);
		setTemplate(null);
		setShown({ status: "loading" });
	}

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await window.juno.templates.get(templateId);
			if (cancelled) return;
			if (!loaded) {
				setShown({ status: "error", message: "It was deleted. Close the preview to go back to Templates." });
				return;
			}
			setTemplate(loaded);
			if (loaded.canvas) {
				const result = await window.juno.templates.renderPdf({
					templateId: loaded.id,
					values: Object.fromEntries(
						loaded.inputs.filter((input) => input.defaultValue).map((input) => [input.key, input.defaultValue ?? ""]),
					),
				});
				if (!cancelled) setShown({ status: "pdf", stamp: Date.now(), pdf: result.pdf, missing: result.missing });
			} else {
				const result = await window.juno.templates.preview({
					bodyHtml: loaded.bodyHtml,
					clientId: null,
					isSpecimen: loaded.reviewedAt === null,
				});
				if (!cancelled) setShown({ status: "html", html: result.html, missing: result.missing });
			}
		})().catch((cause: unknown) => {
			if (!cancelled) setShown({ status: "error", message: messageOf(cause) });
		});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	const read = useCallback(async () => (shown.status === "pdf" ? shown.pdf : new Uint8Array()), [shown]);

	const name = template?.name ?? "Template";
	const pages = template?.canvas ? pagesOf(template.canvas.layout).length : 1;
	const meta = template
		? [
				template.canvas ? paperLabel(template.canvas.paper) : "HTML template",
				`${pages} ${pages === 1 ? "page" : "pages"}`,
				`Changed ${modifiedLabel(template.updatedAt).toLowerCase()}`,
			].join(" · ")
		: "";

	const column = template ? (
		<div className="flex flex-col gap-6 px-6 py-5">
			{template.reviewedAt === null ? (
				<p className="border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					Nobody has checked this text. A document made from it is marked as a specimen and cannot be signed.
				</p>
			) : null}
			{template.description ? <p className="text-sm text-[var(--ink-muted)]">{template.description}</p> : null}
			<section>
				<h3 className="border-b border-[var(--line)] pb-2 text-base font-[var(--weight-medium)]">Asks for</h3>
				{template.inputs.length === 0 ? (
					<p className="mt-3 text-dense text-[var(--ink-muted)]">
						{template.canvas ? "Nothing. It prints as it is." : "Nothing beyond a client and a project."}
					</p>
				) : (
					<ul className="mt-3 flex flex-col gap-1">
						{template.inputs.map((input) => (
							<li key={input.key} className="text-dense">
								{input.label || input.key}
								{input.required ? <span className="text-[var(--ink-muted)]"> (required)</span> : null}
							</li>
						))}
					</ul>
				)}
			</section>
			{(shown.status === "pdf" || shown.status === "html") && shown.missing.length > 0 ? (
				<p className="text-sm text-[var(--ink-muted)]">No value for: {shown.missing.join(", ")}</p>
			) : null}
		</div>
	) : null;

	return (
		<FullPreview
			title={name}
			badges={
				template && template.reviewedAt === null ? (
					<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--risk)]">
						Not reviewed
					</span>
				) : null
			}
			meta={meta}
			position={position}
			closeLabel="Back to Templates"
			onClose={onClose}
			column={column}
			columnOpen={details}
			onToggleColumn={onToggleDetails}
			actions={
				template ? (
					<>
						<Button size="dense" onClick={() => onEdit(template)}>
							Edit
						</Button>
						<Button size="dense" variant="primary" onClick={() => onUse(template)}>
							Use
						</Button>
						<MenuButton
							size="dense"
							ariaLabel="More template actions"
							items={[{ id: "delete", label: "Delete", icon: "remove", danger: true, onSelect: () => onDelete(template) }]}
						/>
					</>
				) : null
			}
		>
			{shown.status === "loading" ? (
				<PreviewSkeleton />
			) : shown.status === "error" ? (
				<div className="flex h-full items-center justify-center bg-[var(--sunken)] p-8">
					<p data-selectable className="max-w-[52ch] border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
						{shown.message}
					</p>
				</div>
			) : shown.status === "pdf" ? (
				<PdfViewer
					fileKey={String(shown.stamp)}
					read={read}
					caption={template?.canvas ? paperLabel(template.canvas.paper) : null}
					empty={<p className="text-[var(--ink-muted)]">Making the PDF.</p>}
				/>
			) : (
				<div className="h-full bg-[var(--sunken)] p-6">
					<iframe
						title={`${name}, preview`}
						sandbox=""
						referrerPolicy="no-referrer"
						srcDoc={shown.html}
						className="mx-auto block h-full w-full max-w-[860px] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
					/>
				</div>
			)}
		</FullPreview>
	);
}
