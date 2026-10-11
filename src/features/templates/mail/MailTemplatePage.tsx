import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { MailTemplate } from "@shared/types";
import { Button } from "../../../components/Button";
import { Icon } from "../../../components/Icon";
import { messageOf } from "../../../lib/errors";
import { framed } from "../../../lib/framed-preview";
import { useCanvasFonts } from "./canvas/use-canvas-fonts";
import { kindLabel } from "./input-kinds";

type MailTemplatePageProps = {
	template: MailTemplate;
	onBack: () => void;
	onEdit: () => void;
	onUse: () => void;
};

type Rendered = { subject: string; html: string };

// Keyed to the template it was rendered for, so opening another one does not
// need an effect to clear the old result: it simply stops matching.
type RenderState =
	| { templateId: string; status: "ready"; rendered: Rendered }
	| { templateId: string; status: "error"; message: string };

/** Until the message has been measured, and for one that cannot be. */
const FALLBACK_HEIGHT = 640;

/**
 * One template, read in full before it is used or changed.
 *
 * It replaces the list rather than sitting beside it, because what is being
 * read is a whole message and a side panel showed a third of one. The frame
 * grows to the height of the message, so the page scrolls and the message
 * does not scroll inside it. Use is the primary action, because using a
 * template is what this screen is for; Edit sits beside it.
 */
export function MailTemplatePage({ template, onBack, onEdit, onUse }: MailTemplatePageProps) {
	const [state, setState] = useState<RenderState | null>(null);
	const [height, setHeight] = useState(FALLBACK_HEIGHT);
	const frameRef = useRef<HTMLIFrameElement>(null);
	// A template with linked fonts is shown in them, the same as in the editor.
	const fonts = useCanvasFonts(template.layout?.fonts ?? []);

	useEffect(() => {
		let cancelled = false;
		// Nothing typed yet, so every input shows its [ontbreekt: ...] marker,
		// which is what makes it plain which parts change each time.
		window.juno.mail.templates
			.render({ templateId: template.id })
			.then((result) => {
				if (cancelled) return;
				setState({
					templateId: template.id,
					status: "ready",
					rendered: { subject: result.subject, html: result.bodyHtml },
				});
			})
			.catch((cause: unknown) => {
				if (!cancelled) setState({ templateId: template.id, status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [template.id]);

	// Escape goes back, the same as on every other page that replaces a list.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || document.querySelector("[role='dialog']")) return;
			onBack();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onBack]);

	const current = state && state.templateId === template.id ? state : null;
	const rendered = current?.status === "ready" ? current.rendered : null;
	const error = current?.status === "error" ? current.message : null;
	const unreviewed = template.isSystem && template.customisedAt === null;

	/**
	 * Sizes the frame to the message inside it, once its pictures (the load
	 * event) and its fonts are in. The frame may be read from this side because
	 * it is same-origin; it still runs no script of its own, which is the half
	 * of the sandbox that matters (security.md section 4).
	 *
	 * It measures where the content ends rather than the document's scroll
	 * height, and it does not watch for resizes: a message whose root fills
	 * the viewport grows with the frame, so sizing the frame to it from an
	 * observer feeds itself and never settles.
	 */
	function measure() {
		const doc = frameRef.current?.contentDocument;
		if (!doc?.body) return;
		const fit = () => {
			const bottom = [...doc.body.children].reduce(
				(lowest, child) => Math.max(lowest, child.getBoundingClientRect().bottom),
				0,
			);
			const margin = parseFloat(doc.defaultView?.getComputedStyle(doc.body).marginBottom ?? "0") || 0;
			if (bottom > 0) setHeight(Math.max(240, Math.ceil(bottom + margin)));
		};
		fit();
		void doc.fonts.ready.then(fit);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-none items-center gap-2 border-b border-[var(--line)] px-6 py-3">
				<button
					type="button"
					onClick={onBack}
					className="-ml-2 inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<ArrowLeftIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
					Mail templates
				</button>
				<span className="flex-none text-[var(--ink-faint)]" aria-hidden>
					/
				</span>
				<h1 className="min-w-0 flex-1 truncate text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
					{template.name}
				</h1>
				<Button onClick={onEdit}>
					<Icon name="edit" />
					Edit
				</Button>
				<Button variant="primary" onClick={onUse}>
					Use
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className="animate-rise w-full">
					{unreviewed ? (
						<p className="mb-4 max-w-[62ch] border-l-2 border-[var(--warn)] pl-3 text-[length:var(--text-sm)] text-[var(--warn)]">
							This text shipped with Juno and has not been edited yet. Read it before it is used.
						</p>
					) : null}

					{template.hiddenAt ? (
						<p className="mb-4 max-w-[62ch] border-l-2 border-[var(--line-strong)] pl-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							This template is not offered when composing. Anything already using it still renders.
						</p>
					) : null}

					{template.description ? (
						<p className="mb-4 max-w-[62ch] text-[var(--ink-muted)]">{template.description}</p>
					) : null}

					<dl className="mb-5 grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3">
						<dt className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Subject</dt>
						<dd className="font-[var(--weight-medium)]">
							{rendered ? rendered.subject : template.subject}
						</dd>
						<dt className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Asks for</dt>
						<dd>
							{template.inputs.length === 0 ? (
								<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									Nothing. It is sent as it is written.
								</span>
							) : (
								<ul className="flex flex-wrap gap-1.5">
									{template.inputs.map((input) => (
										<li
											key={input.key}
											className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-0.5 text-[length:var(--text-sm)]"
										>
											{input.label || input.key}
											{input.required ? <span aria-label="required">*</span> : null}
											<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">
												{kindLabel(input.kind)}
											</span>
										</li>
									))}
								</ul>
							)}
						</dd>
					</dl>

					{error ? (
						<p
							role="alert"
							data-selectable
							className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
						>
							{error}
						</p>
					) : null}

					{rendered ? (
						<div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
							<iframe
								ref={frameRef}
								title="Template preview"
								srcDoc={framed(rendered.html, fonts.css)}
								sandbox="allow-same-origin"
								referrerPolicy="no-referrer"
								onLoad={measure}
								style={{ height }}
								className="block w-full bg-[var(--surface)]"
							/>
						</div>
					) : error ? null : (
						<p className="text-[var(--ink-muted)]">Rendering.</p>
					)}
				</div>
			</div>
		</div>
	);
}
