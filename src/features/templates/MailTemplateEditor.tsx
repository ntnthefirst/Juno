import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MailLayout, MailRegister, MailTemplate, TemplateInput } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { CanvasEditor } from "./mail/canvas/CanvasEditor";
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

type Draft = {
	name: string;
	description: string;
	subject: string;
	register: MailRegister;
	bodyHtml: string;
	inputs: TemplateInput[];
	layout: MailLayout | null;
};

type Preview = { subject: string; html: string; missing: string[] };

const AUTOSAVE_KEY = "juno.mailTemplates.autosave";

/**
 * Editing one mail template.
 *
 * Two things changed from the editor this replaces, and both come from the
 * same old bug. That editor previewed by saving: `mail.templates.render` could
 * only read a saved row, so keeping the preview honest meant writing on a
 * timer, and writing stamped `customisedAt` on templates nobody had
 * deliberately edited. `mail.templates.preview` renders values in hand, so a
 * preview is a read again.
 *
 * With that fixed, saving became a choice rather than a mechanism, which is
 * what the autosave switch is. Off, the button is the only way out. On, the
 * hook waits for a pause, saves anyway once an edit is old enough, and does
 * nothing at all when nothing changed.
 *
 * A template with a layout is edited on the canvas and its HTML is compiled
 * from it. A template without one is what everything written before the canvas
 * is, and it keeps the visual and code editors it has always had.
 */
export function MailTemplateEditor({ templateId, onBack, onSaved }: MailTemplateEditorProps) {
	const [template, setTemplate] = useState<MailTemplate | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [tab, setTab] = useState<"canvas" | "visual" | "code">("visual");
	const [code, setCode] = useState<string | null>(null);

	const [preview, setPreview] = useState<Preview | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [savedAt, setSavedAt] = useState<number | null>(null);

	// Remembered per machine rather than per template: it is a habit about how
	// somebody works, not a property of one piece of text.
	const [autosave, setAutosave] = useState(() => {
		try {
			return window.localStorage.getItem(AUTOSAVE_KEY) === "on";
		} catch {
			return false;
		}
	});

	// State, not a ref: `dirty` below is read during render, so what is saved
	// has to be something React re-renders on.
	const [savedKey, setSavedKey] = useState("");

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
				const loaded: Draft = {
					name: row.name,
					description: row.description ?? "",
					subject: row.subject,
					register: row.register,
					bodyHtml: row.bodyHtml,
					inputs: row.inputs,
					layout: row.layout,
				};
				setTemplate(row);
				setDraft(loaded);
				setTab(row.layout ? "canvas" : "visual");
				setSavedKey(JSON.stringify(loaded));
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	const draftKey = draft ? JSON.stringify(draft) : "";
	const dirty = Boolean(draft) && draftKey !== savedKey;

	const save = useCallback(async (): Promise<void> => {
		if (!draft) return;
		setSaving(true);
		setError(null);
		try {
			const updated = await window.juno.mail.templates.update(templateId, {
				name: draft.name,
				description: draft.description.trim() || null,
				subject: draft.subject,
				register: draft.register,
				bodyHtml: draft.bodyHtml,
				inputs: draft.inputs,
				layout: draft.layout,
			});
			setTemplate(updated);
			setSavedKey(JSON.stringify(draft));
			setSavedAt(Date.now());
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setSaving(false);
		}
	}, [draft, onSaved, templateId]);

	// Autosave: a pause of 1.5s, or 15s after the oldest unsaved edit whichever
	// comes first, and never when nothing changed. Written here rather than in
	// a shared hook because it has to close over the same `dirty` the button
	// reads, so the two can never disagree about whether there is work to do.
	const dirtySince = useRef<number | null>(null);
	useEffect(() => {
		if (!dirty) {
			dirtySince.current = null;
			return;
		}
		if (dirtySince.current === null) dirtySince.current = Date.now();
		if (!autosave || saving) return;
		const age = Date.now() - dirtySince.current;
		const wait = Math.max(0, Math.min(1500, 15000 - age));
		const timer = window.setTimeout(() => void save(), wait);
		return () => window.clearTimeout(timer);
	}, [dirty, draftKey, autosave, saving, save]);

	// The preview is a read, so it runs whether or not anything is being saved,
	// and it is debounced on its own clock.
	useEffect(() => {
		if (!draft) return;
		const timer = window.setTimeout(() => {
			let cancelled = false;
			window.juno.mail.templates
				.preview({
					subject: draft.subject,
					bodyHtml: draft.bodyHtml,
					layout: draft.layout,
					inputs: draft.inputs,
					clientId: null,
				})
				.then((result) => {
					if (cancelled) return;
					setPreview({ subject: result.subject, html: result.bodyHtml, missing: result.missing });
					setPreviewError(null);
				})
				.catch((cause: unknown) => {
					if (!cancelled) setPreviewError(messageOf(cause));
				});
			return () => {
				cancelled = true;
			};
		}, 500);
		return () => window.clearTimeout(timer);
	}, [draftKey, draft]);

	const patch = useCallback((next: Partial<Draft>) => {
		setDraft((current) => (current ? { ...current, ...next } : current));
	}, []);

	const placeholderGroups = useMemo(
		() => mailPlaceholderGroups(draft?.inputs ?? []),
		[draft?.inputs],
	);

	if (!draft || !template) {
		return (
			<div className="flex h-full flex-col overflow-y-auto p-8">
				<div className="mx-auto w-full max-w-[var(--content-width)]">
					<p className="text-[var(--ink-muted)]">{error ?? "Loading."}</p>
				</div>
			</div>
		);
	}

	const unreviewed = template.isSystem && template.customisedAt === null;
	const tabs: { id: "canvas" | "visual" | "code"; label: string }[] = draft.layout
		? [
				{ id: "canvas", label: "Canvas" },
				{ id: "code", label: "Code" },
			]
		: [
				{ id: "visual", label: "Visual" },
				{ id: "code", label: "Code" },
			];

	const status = saving
		? "Saving"
		: dirty
			? autosave
				? "Unsaved"
				: "Not saved"
			: savedAt
				? "Saved."
				: "";

	return (
		<FormPage
			title={draft.name || "Mail template"}
			onBack={onBack}
			width="wide"
			actions={
				<>
					<span className="mr-auto flex items-center gap-3">
						<label className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							<input
								type="checkbox"
								checked={autosave}
								onChange={(event) => {
									setAutosave(event.target.checked);
									try {
										window.localStorage.setItem(AUTOSAVE_KEY, event.target.checked ? "on" : "off");
									} catch {
										// A browser with storage blocked still gets the switch for this
										// session; only the memory of it is lost.
									}
								}}
								className="h-4 w-4 accent-[var(--accent)]"
							/>
							Autosave
						</label>
						{status ? (
							<span
								className={`text-[length:var(--text-sm)] ${
									dirty ? "text-[var(--ink-muted)]" : "text-[var(--ok)]"
								}`}
							>
								{status}
							</span>
						) : null}
					</span>
					<Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
						{saving ? "Saving" : "Save"}
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
				<Field label="Name" value={draft.name} onChange={(v) => patch({ name: v })} required />
				<Select
					label="Register"
					value={draft.register}
					onChange={(v) => patch({ register: v as MailRegister })}
					options={REGISTER_OPTIONS}
				/>
				<div className="sm:col-span-2">
					<Field
						label="Description"
						value={draft.description}
						onChange={(v) => patch({ description: v })}
						placeholder="Shown in the template list"
					/>
				</div>
				<div className="sm:col-span-2">
					<Field label="Subject" value={draft.subject} onChange={(v) => patch({ subject: v })} required />
				</div>
			</div>

			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			<div className="mt-6">
				<div className="mb-1 flex items-center gap-2">
					<span className="block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Body</span>
					{draft.layout ? (
						<Button
							size="dense"
							onClick={() => {
								patch({ layout: null });
								setTab("visual");
							}}
						>
							Keep as HTML
						</Button>
					) : (
						<Button
							size="dense"
							onClick={() => {
								// The body it already has becomes one raw block, which the
								// author can then break into sections. Compiling it into
								// blocks automatically would rewrite somebody's hand-written
								// table without being asked.
								void window.juno.mail.templates
									.parseBody(draft.bodyHtml)
									.then((next) => {
										patch({ layout: next });
										setTab("canvas");
									})
									.catch((cause: unknown) => setError(messageOf(cause)));
							}}
						>
							Lay out on a canvas
						</Button>
					)}
				</div>

				<div className="flex items-center gap-px border-b border-[var(--line)]" role="tablist" aria-label="Body">
					{tabs.map((entry) => (
						<button
							key={entry.id}
							type="button"
							role="tab"
							aria-selected={tab === entry.id}
							onClick={() => {
								setTab(entry.id);
								if (entry.id === "code") setCode(draft.bodyHtml);
							}}
							className={`-mb-px flex h-[36px] items-center gap-2 border-b-2 px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								tab === entry.id
									? "border-[var(--accent)] text-[var(--accent)]"
									: "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
							}`}
						>
							{entry.label}
						</button>
					))}
				</div>

				{tab === "canvas" && draft.layout ? (
					<CanvasEditor
						layout={draft.layout}
						inputs={draft.inputs}
						onChange={(next) => patch({ layout: next })}
					/>
				) : null}

				{tab === "visual" && !draft.layout ? (
					<div className="overflow-hidden rounded-b-[var(--radius-lg)] border border-t-0 border-[var(--line)]">
						<VisualEditor
							active
							value={draft.bodyHtml}
							onChange={(v) => patch({ bodyHtml: v })}
							disabled={saving}
							placeholderGroups={placeholderGroups}
						/>
					</div>
				) : null}

				{tab === "code" ? (
					<div className="rounded-b-[var(--radius-lg)] border border-t-0 border-[var(--line)]">
						<HtmlCodeEditor
							active
							value={code ?? draft.bodyHtml}
							onChange={(v) => {
								setCode(v);
								// Without a canvas the HTML is the template, so typing here is
								// editing it directly.
								if (!draft.layout) patch({ bodyHtml: v });
							}}
							disabled={saving}
						/>
						{draft.layout ? (
							<div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-2">
								<Button
									size="dense"
									disabled={code === null}
									onClick={() => {
										void window.juno.mail.templates
											.parseBody(code ?? draft.bodyHtml)
											.then((next) => {
												patch({ layout: next });
												setCode(null);
												setTab("canvas");
											})
											.catch((cause: unknown) => setError(messageOf(cause)));
									}}
								>
									Apply to canvas
								</Button>
								<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									Markup the canvas knows comes back as the block it was. Anything else comes back
									as a raw block where you wrote it, so nothing is lost. The structure is kept, the
									exact spacing is not.
								</p>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="mt-6">
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Preview</p>
				{previewError ? (
					<p
						role="alert"
						data-selectable
						className="mt-1 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
					>
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
							<iframe
								title="Template preview"
								srcDoc={preview.html}
								sandbox=""
								referrerPolicy="no-referrer"
								className="block h-[420px] w-full bg-[var(--surface)]"
							/>
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
					A value nothing in the records can answer. Each one becomes a placeholder in the body, so
					it can be written in and filled every time this template is used. An input of kind image
					can be dropped on the canvas as a picture.
				</p>
				<div className="mt-4">
					<TemplateInputsEditor
						inputs={draft.inputs}
						onChange={(next) => patch({ inputs: next })}
						disabled={saving}
					/>
				</div>
			</div>
		</FormPage>
	);
}
