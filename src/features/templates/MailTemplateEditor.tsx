import { useCallback, useEffect, useRef, useState } from "react";
import type { MailRegister, MailTemplate, TemplateInput } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { HtmlCodeEditor } from "./mail/HtmlCodeEditor";
import { mailPlaceholderGroups } from "./mail/placeholders";
import { TemplateInputsEditor } from "./mail/TemplateInputsEditor";
import { VisualEditor } from "./mail/VisualEditor";

type MailTemplateEditorProps = {
	templateId: string;
	onBack: () => void;
	onSaved: () => void;
};

const REGISTER_OPTIONS: { value: MailRegister; label: string }[] = [
	{ value: "u", label: "u (formal)" },
	{ value: "je", label: "je (familiar)" },
];

const EDIT_TABS: { id: "visual" | "code"; label: string }[] = [
	{ id: "visual", label: "Visual" },
	{ id: "code", label: "Code" },
];

/**
 * Two views over one HTML document (docs/editors.md section 2): Visual, a
 * contentEditable surface with a formatting toolbar, and Code, the same
 * string in CodeMirror. Neither is the source of truth over the other;
 * `bodyHtml` in this component's state is, and both views read and write it
 * the same way MarkdownEditor's controlled value works, so switching tabs
 * never rewrites markup nobody touched.
 *
 * The preview can only ever show what `mail.templates.render` renders, and
 * that always reads the saved row rather than taking body text as an
 * argument (electron/main/services/mail-templates.ts). So a "live" preview
 * here means a debounced autosave followed by a render, not a separate
 * render-from-draft path this project does not have. The explicit Save
 * button exists for the deliberate moment and the "Saved." confirmation;
 * the debounce exists so the preview below is never far behind what is
 * typed.
 */
export function MailTemplateEditor({ templateId, onBack, onSaved }: MailTemplateEditorProps) {
	const [template, setTemplate] = useState<MailTemplate | null>(null);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [subject, setSubject] = useState("");
	const [register, setRegister] = useState<MailRegister>("u");
	const [bodyHtml, setBodyHtml] = useState("");
	const [inputs, setInputs] = useState<TemplateInput[]>([]);
	const [editTab, setEditTab] = useState<"visual" | "code">("visual");

	const [preview, setPreview] = useState<{ subject: string; html: string; missing: string[] } | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | null>(null);
	const [saved, setSaved] = useState(false);

	const cancelledRef = useRef(false);
	const runningRef = useRef(false);
	const pendingRef = useRef(false);
	// The first time these fields hold the fetched values is hydration, not an
	// edit. Without this guard the debounce effect below would fire on load and
	// stamp customisedAt on a template nobody has touched yet (data.md section 9).
	const skippedInitialRef = useRef(false);
	// runPreview reads from here rather than closing over name/description/...
	// directly, so its own identity does not need to change every time one of
	// them does, and the debounce effect below can depend on it honestly.
	const latestRef = useRef({ name, description, subject, register, bodyHtml, inputs });

	useEffect(() => {
		latestRef.current = { name, description, subject, register, bodyHtml, inputs };
	});

	useEffect(() => {
		cancelledRef.current = false;
		return () => {
			cancelledRef.current = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.templates
			.get(templateId)
			.then((row) => {
				if (cancelled) return;
				if (!row) {
					setError("That template no longer exists.");
					return;
				}
				setTemplate(row);
				setName(row.name);
				setDescription(row.description ?? "");
				setSubject(row.subject);
				setRegister(row.register);
				setBodyHtml(row.bodyHtml);
				setInputs(row.inputs);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	// Loops rather than recursing: if a field changes again while the current
	// save-and-render round is still in flight, one more round runs with
	// whatever is in latestRef by then, and at most one request pair is ever
	// on the wire at once.
	const runPreview = useCallback(async () => {
		if (runningRef.current) {
			pendingRef.current = true;
			return;
		}
		runningRef.current = true;
		try {
			do {
				pendingRef.current = false;
				const current = latestRef.current;
				const updated = await window.juno.mail.templates.update(templateId, {
					name: current.name,
					description: current.description.trim() || null,
					subject: current.subject,
					register: current.register,
					bodyHtml: current.bodyHtml,
					inputs: current.inputs,
				});
				if (cancelledRef.current) return;
				setTemplate(updated);
				const rendered = await window.juno.mail.templates.render({ templateId, clientId: null });
				if (cancelledRef.current) return;
				setPreview({ subject: rendered.subject, html: rendered.bodyHtml, missing: rendered.missing });
				setPreviewError(null);
			} while (pendingRef.current);
		} catch (cause: unknown) {
			if (!cancelledRef.current) setPreviewError(messageOf(cause));
		} finally {
			runningRef.current = false;
		}
	}, [templateId]);

	useEffect(() => {
		if (!template) return;
		if (!skippedInitialRef.current) {
			skippedInitialRef.current = true;
			return;
		}
		const timer = window.setTimeout(() => {
			void runPreview();
		}, 600);
		return () => window.clearTimeout(timer);
	}, [name, description, subject, register, bodyHtml, inputs, template, runPreview]);

	async function save() {
		if (busy) return;
		setBusy("save");
		setError(null);
		try {
			const updated = await window.juno.mail.templates.update(templateId, {
				name,
				description: description.trim() || null,
				subject,
				register,
				bodyHtml,
				inputs,
			});
			setTemplate(updated);
			setSaved(true);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	if (!template) {
		return (
			<div className="flex h-full flex-col overflow-y-auto p-8">
				<div className="mx-auto w-full max-w-[var(--content-width)]">
					<p className="text-[var(--ink-muted)]">{error ?? "Loading."}</p>
				</div>
			</div>
		);
	}

	const unreviewed = template.isSystem && template.customisedAt === null;
	const placeholderGroups = mailPlaceholderGroups(inputs);

	return (
		<FormPage
			title={template.name || "Mail template"}
			onBack={onBack}
			width="wide"
			actions={
				<>
					{saved ? <span className="mr-auto text-[length:var(--text-sm)] text-[var(--ok)]">Saved.</span> : null}
					<Button variant="primary" disabled={busy !== null} onClick={() => void save()}>
						{busy === "save" ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			{unreviewed ? (
				<p className="mb-4 border-l-2 border-[var(--warn)] pl-3 text-[length:var(--text-sm)] text-[var(--warn)]">
					This text shipped with Juno and has not been edited yet. Read it before it is used.
				</p>
			) : null}

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_200px]">
				<Field label="Name" value={name} onChange={(v) => { setName(v); setSaved(false); }} required />
				<Select
					label="Register"
					value={register}
					onChange={(v) => { setRegister(v as MailRegister); setSaved(false); }}
					options={REGISTER_OPTIONS}
				/>
				<div className="sm:col-span-2">
					<Field
						label="Description"
						value={description}
						onChange={(v) => { setDescription(v); setSaved(false); }}
						placeholder="Shown in the template list"
					/>
				</div>
				<div className="sm:col-span-2">
					<Field label="Subject" value={subject} onChange={(v) => { setSubject(v); setSaved(false); }} required />
				</div>
			</div>

			{error ? (
				<p role="alert" data-selectable className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}

			<div className="mt-6">
				<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Body</span>
				<div
					className="flex items-center gap-px border-b border-[var(--line)]"
					role="tablist"
					aria-label="Body"
				>
					{EDIT_TABS.map((entry) => (
						<button
							key={entry.id}
							type="button"
							role="tab"
							aria-selected={editTab === entry.id}
							onClick={() => setEditTab(entry.id)}
							className={`-mb-px flex h-[36px] items-center gap-2 border-b-2 px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								editTab === entry.id
									? "border-[var(--accent)] text-[var(--accent)]"
									: "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
							}`}
						>
							{entry.label}
						</button>
					))}
				</div>
				<div className="overflow-hidden rounded-b-[var(--radius-lg)] border border-t-0 border-[var(--line)]">
					<VisualEditor
						active={editTab === "visual"}
						value={bodyHtml}
						onChange={(v) => { setBodyHtml(v); setSaved(false); }}
						disabled={busy !== null}
						placeholderGroups={placeholderGroups}
					/>
					<HtmlCodeEditor
						active={editTab === "code"}
						value={bodyHtml}
						onChange={(v) => { setBodyHtml(v); setSaved(false); }}
						disabled={busy !== null}
					/>
				</div>
			</div>

			<div className="mt-6">
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Preview</p>
				{previewError ? (
					<p role="alert" data-selectable className="mt-1 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						{previewError}
					</p>
				) : null}
				{preview ? (
					<>
						<p className="mt-1 font-[var(--weight-medium)]">{preview.subject}</p>
						{preview.missing.length > 0 ? (
							<p className="mt-2 text-[length:var(--text-sm)] text-[var(--risk)]">
								No value for: {preview.missing.join(", ")}
							</p>
						) : null}
						<div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
							<iframe title="Template preview" srcDoc={preview.html} sandbox="" referrerPolicy="no-referrer" className="block h-[420px] w-full bg-[var(--surface)]" />
						</div>
					</>
				) : previewError ? null : (
					<p className="mt-1 text-[var(--ink-muted)]">Rendering.</p>
				)}
			</div>

			<div className="mt-8">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
					What this asks for
				</h2>
				<p className="mt-1 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					A value nothing in the records can answer. Each one becomes a placeholder in the body,
					so it can be written in and filled every time this template is used.
				</p>
				<div className="mt-4">
					<TemplateInputsEditor
						inputs={inputs}
						onChange={(next) => { setInputs(next); setSaved(false); }}
						disabled={busy !== null}
					/>
				</div>
			</div>
		</FormPage>
	);
}
