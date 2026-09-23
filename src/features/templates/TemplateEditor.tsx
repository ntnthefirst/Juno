import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { ClientSummary, DocumentLayout, DocumentTemplate, LayoutBlock, LayoutBox, TemplateInput } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import {
	addBlock,
	addBox,
	addPage,
	emptyLayout,
	moveBlock,
	removeBlock,
	removeBox,
	removePage,
	updateBlock,
	updateBox,
	updateBoxBlock,
	type BlockKind,
	newBlock,
	newBox,
} from "./page/layout-actions";
import { Inspector, type InspectorTarget } from "./page/Inspector";
import { InsertToolbar, type PlacementMode } from "./page/InsertToolbar";
import { PageCanvas, type CanvasSelection } from "./page/PageCanvas";
import { TemplateInputsEditor } from "./mail/TemplateInputsEditor";

type Loaded = {
	template: DocumentTemplate;
	clients: ClientSummary[];
};

type Load =
	| { status: "loading" }
	| { status: "ready"; loaded: Loaded }
	| { status: "error"; message: string };

type Preview =
	| { status: "idle" }
	| { status: "running" }
	| { status: "ready"; html: string; missing: string[] }
	| { status: "error"; message: string };

type DetailsTab = "layout" | "details";

type ZoomChoice = "fit" | "0.5" | "0.75" | "1";

const ZOOM_OPTIONS: { value: ZoomChoice; label: string }[] = [
	{ value: "fit", label: "Fit" },
	{ value: "0.5", label: "50%" },
	{ value: "0.75", label: "75%" },
	{ value: "1", label: "100%" },
];

type TemplateEditorProps = {
	templateId: string;
	onSaved: () => void;
	onBack: () => void;
};

/**
 * A template with `layout: null` is edited as raw HTML, the way this editor
 * has always worked, because compiling a hand-written contract into blocks
 * would lose whatever was done by hand (docs/editors.md section 3). A
 * template with a layout gets the page editor: a canvas, an insert rail and
 * an inspector, over the model in electron/shared/types.ts.
 */
export function TemplateEditor({ templateId, onSaved, onBack }: TemplateEditorProps) {
	const bodyId = useId();
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [htmlDraft, setHtmlDraft] = useState("");
	const [layoutDraft, setLayoutDraft] = useState<DocumentLayout | null>(null);
	const [inputsDraft, setInputsDraft] = useState<TemplateInput[]>([]);
	const [tab, setTab] = useState<DetailsTab>("layout");
	const [selection, setSelection] = useState<CanvasSelection>(null);
	const [activePageId, setActivePageId] = useState("");
	const [placement, setPlacement] = useState<PlacementMode>("flow");
	const [zoom, setZoom] = useState<ZoomChoice>("fit");
	const [previewClientId, setPreviewClientId] = useState("");
	const [preview, setPreview] = useState<Preview>({ status: "idle" });
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmingEdit, setConfirmingEdit] = useState(false);
	const [confirmingBack, setConfirmingBack] = useState(false);
	const [confirmingStart, setConfirmingStart] = useState(false);

	const fetchAll = useCallback(async (): Promise<Loaded | null> => {
		const [template, clients] = await Promise.all([
			window.juno.templates.get(templateId),
			window.juno.clients.list(),
		]);
		return template ? { template, clients } : null;
	}, [templateId]);

	const applyLoaded = useCallback((template: DocumentTemplate) => {
		setName(template.name);
		setDescription(template.description ?? "");
		setInputsDraft(template.inputs);
		if (template.layout) {
			setLayoutDraft(template.layout);
			setHtmlDraft("");
			setActivePageId((current) =>
				template.layout!.pages.some((page) => page.id === current) ? current : (template.layout!.pages[0]?.id ?? ""),
			);
		} else {
			setLayoutDraft(null);
			setHtmlDraft(template.bodyHtml);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetchAll()
			.then((loaded) => {
				if (cancelled) return;
				if (!loaded) {
					setLoad({ status: "error", message: "This template is no longer in your juno." });
					return;
				}
				setLoad({ status: "ready", loaded });
				applyLoaded(loaded.template);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchAll, applyLoaded]);

	const template = load.status === "ready" ? load.loaded.template : null;
	const hasLayout = layoutDraft !== null;
	const reviewed = template !== null && template.reviewedAt !== null;

	const dirty = useMemo(() => {
		if (!template) return false;
		if (name.trim() !== template.name) return true;
		if ((description.trim() || null) !== template.description) return true;
		if (JSON.stringify(inputsDraft) !== JSON.stringify(template.inputs)) return true;
		if (hasLayout) return JSON.stringify(layoutDraft) !== JSON.stringify(template.layout);
		return htmlDraft !== template.bodyHtml;
	}, [template, name, description, inputsDraft, hasLayout, layoutDraft, htmlDraft]);

	async function save() {
		if (!template || busy) return;
		const trimmed = name.trim();
		setNameError(trimmed.length === 0 ? "Enter a name." : null);
		if (trimmed.length === 0) return;

		setConfirmingEdit(false);
		setError(null);
		setBusy(true);
		try {
			const saved = await window.juno.templates.update(template.id, {
				name: trimmed,
				description: description.trim() || null,
				inputs: inputsDraft,
				...(hasLayout ? { layout: layoutDraft } : { bodyHtml: htmlDraft }),
			});
			setLoad((current) =>
				current.status === "ready"
					? { status: "ready", loaded: { ...current.loaded, template: saved } }
					: current,
			);
			applyLoaded(saved);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	function requestSave() {
		// Saving clears the review flag server-side when the content changed, so
		// the claim being withdrawn is stated before it happens.
		if (reviewed && dirty) setConfirmingEdit(true);
		else void save();
	}

	function requestBack() {
		if (dirty) setConfirmingBack(true);
		else onBack();
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			requestBack();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- requestBack closes over dirty, read fresh via the effect re-running whenever it changes
	}, [dirty]);

	async function toggleReviewed() {
		if (!template || busy) return;
		setError(null);
		setBusy(true);
		try {
			const saved = await window.juno.templates.setReviewed(template.id, !reviewed);
			setLoad((current) =>
				current.status === "ready"
					? { status: "ready", loaded: { ...current.loaded, template: saved } }
					: current,
			);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function runPreview() {
		if (!template) return;
		setPreview({ status: "running" });
		try {
			const bodyHtml = hasLayout ? template.bodyHtml : htmlDraft;
			const result = await window.juno.templates.preview({
				bodyHtml,
				clientId: previewClientId.length > 0 ? previewClientId : null,
				isSpecimen: !reviewed,
			});
			setPreview({ status: "ready", html: result.html, missing: result.missing });
		} catch (cause: unknown) {
			setPreview({ status: "error", message: messageOf(cause) });
		}
	}

	async function startLayout() {
		if (!template || busy) return;
		setConfirmingStart(false);
		setError(null);
		setBusy(true);
		try {
			const saved = await window.juno.templates.update(template.id, { layout: emptyLayout() });
			setLoad((current) =>
				current.status === "ready"
					? { status: "ready", loaded: { ...current.loaded, template: saved } }
					: current,
			);
			applyLoaded(saved);
			setSelection(null);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	/* --------------------------------------------------------- layout edits */

	function insertBlock(kind: BlockKind) {
		if (!layoutDraft || activePageId.length === 0) return;
		if (placement === "flow") {
			const block = newBlock(kind);
			setLayoutDraft((current) => (current ? addBlock(current, activePageId, block) : current));
			setSelection({ kind: "block", pageId: activePageId, blockId: block.id });
		} else {
			const box = newBox(kind);
			setLayoutDraft((current) => (current ? addBox(current, activePageId, box) : current));
			setSelection({ kind: "box", pageId: activePageId, boxId: box.id });
		}
	}

	function updateSelectedContent(patch: Partial<LayoutBlock>) {
		if (!selection) return;
		setLayoutDraft((current) => {
			if (!current) return current;
			return selection.kind === "block"
				? updateBlock(current, selection.pageId, selection.blockId, patch)
				: updateBoxBlock(current, selection.pageId, selection.boxId, patch);
		});
	}

	function moveSelectedBlock(direction: -1 | 1) {
		if (!selection || selection.kind !== "block") return;
		const { pageId, blockId } = selection;
		setLayoutDraft((current) => (current ? moveBlock(current, pageId, blockId, direction) : current));
	}

	function updateSelectedBoxPosition(patch: Partial<Pick<LayoutBox, "xMm" | "yMm" | "widthMm">>) {
		if (!selection || selection.kind !== "box") return;
		const { pageId, boxId } = selection;
		setLayoutDraft((current) => (current ? updateBox(current, pageId, boxId, patch) : current));
	}

	function moveBox(pageId: string, boxId: string, xMm: number, yMm: number) {
		setLayoutDraft((current) => (current ? updateBox(current, pageId, boxId, { xMm, yMm }) : current));
	}

	function deleteSelected() {
		if (!selection) return;
		const { pageId } = selection;
		setLayoutDraft((current) => {
			if (!current) return current;
			return selection.kind === "block"
				? removeBlock(current, pageId, selection.blockId)
				: removeBox(current, pageId, selection.boxId);
		});
		setSelection(null);
	}

	function handleAddPage() {
		setLayoutDraft((current) => (current ? addPage(current) : current));
	}

	function handleDeletePage() {
		if (!layoutDraft || layoutDraft.pages.length <= 1) return;
		const pageId = activePageId;
		setLayoutDraft((current) => (current ? removePage(current, pageId) : current));
		setSelection((current) => (current && current.pageId === pageId ? null : current));
	}

	if (load.status === "loading") return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] p-8 pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load this template.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { clients } = load.loaded;
	const current = load.loaded.template;

	const inspectorTarget: InspectorTarget | null = (() => {
		if (!selection || !layoutDraft) return null;
		const page = layoutDraft.pages.find((p) => p.id === selection.pageId);
		if (!page) return null;
		if (selection.kind === "block") {
			const index = page.blocks.findIndex((block) => block.id === selection.blockId);
			if (index < 0) return null;
			return { kind: "block", block: page.blocks[index]!, canMoveUp: index > 0, canMoveDown: index < page.blocks.length - 1 };
		}
		const box = page.boxes.find((b) => b.id === selection.boxId);
		return box ? { kind: "box", box } : null;
	})();

	const saveActions = (
		<>
			{dirty ? (
				<span className="text-[length:var(--text-sm)] text-[var(--warn)]">Unsaved changes</span>
			) : (
				<span className="text-[length:var(--text-sm)] text-[var(--ok)]">Saved</span>
			)}
			<Button disabled={busy} onClick={() => void toggleReviewed()}>
				{reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
			</Button>
			<Button variant="primary" disabled={busy} onClick={requestSave}>
				{busy ? "Saving" : "Save"}
			</Button>
		</>
	);

	const confirmDialogs = (
		<>
			{confirmingEdit ? (
				<Dialog title="Save this edit" width="narrow" onClose={() => setConfirmingEdit(false)}>
					<p className="mt-3 text-[length:var(--text-base)]">
						Saving this change clears the reviewed mark and moves this template to version{" "}
						{current.version + 1}. Documents generated after that are marked as specimens until you review
						it again.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingEdit(false)}>Cancel</Button>
						<Button variant="primary" onClick={() => void save()}>
							Save anyway
						</Button>
					</div>
				</Dialog>
			) : null}

			{confirmingBack ? (
				<Dialog title="Leave without saving" width="narrow" onClose={() => setConfirmingBack(false)}>
					<p className="mt-3 text-[length:var(--text-base)]">
						What you changed here is not saved. Leaving now discards it.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingBack(false)}>Cancel</Button>
						<Button
							variant="danger"
							onClick={() => {
								setConfirmingBack(false);
								onBack();
							}}
						>
							Discard and leave
						</Button>
					</div>
				</Dialog>
			) : null}

			{confirmingStart ? (
				<Dialog title="Start a page layout" width="narrow" onClose={() => setConfirmingStart(false)}>
					<p className="mt-3 text-[length:var(--text-base)]">
						This replaces the current text with a single empty page. What is written here by hand is not
						carried over, and there is no way back to it from inside this editor once you continue.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingStart(false)}>Cancel</Button>
						<Button variant="primary" onClick={() => void startLayout()}>
							Start a page layout
						</Button>
					</div>
				</Dialog>
			) : null}
		</>
	);

	if (!hasLayout) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex flex-none items-center justify-between gap-2 border-b border-[var(--line)] px-6 py-3">
					<div className="flex min-w-0 items-center gap-2">
						<button
							type="button"
							onClick={requestBack}
							className="-ml-2 inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						>
							<ArrowLeftIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
							Back
						</button>
						<span aria-hidden className="text-[var(--ink-faint)]">
							/
						</span>
						<h1 className="min-w-0 truncate text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
							{name || "Untitled template"}
						</h1>
					</div>
					<div className="flex items-center gap-2">{saveActions}</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
					<div className="mx-auto w-full max-w-[var(--content-width)]">
						{reviewed ? null : (
							<p className="max-w-[62ch] border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
								Nobody has checked this text. Every document generated from it is marked as a specimen
								and cannot be signed.
							</p>
						)}

						{error ? (
							<p
								role="alert"
								data-selectable
								className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
							>
								{error}
							</p>
						) : null}

						<div className="mt-8 grid grid-cols-2 gap-4">
							<Field label="Name" required value={name} onChange={setName} error={nameError} />
							<Field label="Description" value={description} onChange={setDescription} />
						</div>

						<section className="mt-10">
							<label htmlFor={bodyId} className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Body
							</label>
							<textarea
								id={bodyId}
								value={htmlDraft}
								onChange={(event) => setHtmlDraft(event.target.value)}
								spellCheck={false}
								className="h-[420px] w-full resize-y rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] p-3 text-[length:var(--text-dense)] leading-[var(--leading-relaxed)] text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
								style={{ fontFamily: "var(--font-mono)" }}
							/>
						</section>

						<section className="mt-10 border-t border-[var(--line)] pt-6">
							<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Page layout</h3>
							<p className="mt-2 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								This template is still plain HTML. A page layout gives you pages, a margin and blocks
								you place rather than markup you write. Starting one replaces the text above with an
								empty page; nothing written here comes with it.
							</p>
							<div className="mt-3">
								<Button onClick={() => setConfirmingStart(true)}>Start a page layout</Button>
							</div>
						</section>

						<section className="mt-10">
							<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
								Inputs
							</h3>
							<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								What this template asks for beyond a client and a project.
							</p>
							<div className="mt-4">
								<TemplateInputsEditor inputs={inputsDraft} onChange={setInputsDraft} />
							</div>
						</section>

						<section className="mt-10">
							<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
								Placeholders
							</h3>
							{current.placeholders.length === 0 ? (
								<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									This template refers to no values.
								</p>
							) : (
								<ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
									{current.placeholders.map((path) => (
										<li
											key={path}
											data-selectable
											className="text-[length:var(--text-dense)] text-[var(--ink-muted)]"
											style={{ fontFamily: "var(--font-mono)" }}
										>
											{path}
										</li>
									))}
								</ul>
							)}
						</section>

						<section className="mt-10">
							<div className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-2">
								<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Preview</h3>
								<div className="flex items-end gap-2">
									<div className="w-[220px]">
										<Select
											label="Against client"
											value={previewClientId}
											onChange={setPreviewClientId}
											placeholder="No client"
											options={clients.map((row) => ({ value: row.id, label: row.name }))}
										/>
									</div>
									<Button disabled={preview.status === "running"} onClick={() => void runPreview()}>
										{preview.status === "running" ? "Rendering" : "Refresh preview"}
									</Button>
								</div>
							</div>

							{preview.status === "idle" ? (
								<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									Refresh the preview to render the body as it stands.
								</p>
							) : preview.status === "running" ? (
								<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">Rendering.</p>
							) : preview.status === "error" ? (
								<p
									data-selectable
									className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
								>
									{preview.message}
								</p>
							) : (
								<>
									{preview.missing.length > 0 ? (
										<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											Missing here: {preview.missing.join(", ")}
										</p>
									) : null}
									<iframe
										title="Template preview"
										sandbox=""
										referrerPolicy="no-referrer"
										srcDoc={preview.html}
										className="mt-4 h-[520px] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
									/>
								</>
							)}
						</section>
					</div>
				</div>

				{confirmDialogs}
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-none items-center justify-between gap-2 border-b border-[var(--line)] px-6 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<button
						type="button"
						onClick={requestBack}
						className="-ml-2 inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<ArrowLeftIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
						Back
					</button>
					<span aria-hidden className="text-[var(--ink-faint)]">
						/
					</span>
					<h1 className="min-w-0 truncate text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
						{name || "Untitled template"}
					</h1>
					<div className="ml-2 flex rounded-[var(--radius-md)] bg-[var(--sunken)] p-0.5" role="group" aria-label="View">
						<button
							type="button"
							aria-pressed={tab === "layout"}
							onClick={() => setTab("layout")}
							className={`h-[28px] rounded-[var(--radius-sm)] px-3 text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								tab === "layout" ? "bg-[var(--surface)] text-[var(--ink)]" : "text-[var(--ink-muted)]"
							}`}
						>
							Layout
						</button>
						<button
							type="button"
							aria-pressed={tab === "details"}
							onClick={() => setTab("details")}
							className={`h-[28px] rounded-[var(--radius-sm)] px-3 text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								tab === "details" ? "bg-[var(--surface)] text-[var(--ink)]" : "text-[var(--ink-muted)]"
							}`}
						>
							Details
						</button>
					</div>
				</div>
				<div className="flex items-center gap-2">{saveActions}</div>
			</div>

			{reviewed ? null : (
				<p className="flex-none border-b border-[var(--line)] px-6 py-2 text-[length:var(--text-sm)] text-[var(--risk)]">
					Nobody has checked this text. Every document generated from it is marked as a specimen and cannot
					be signed.
				</p>
			)}

			{error ? (
				<p
					role="alert"
					data-selectable
					className="flex-none border-b border-[var(--line)] px-6 py-2 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			{tab === "layout" ? (
				<div className="flex min-h-0 flex-1">
					<div className="w-[220px] flex-none">
						<InsertToolbar
							placement={placement}
							onPlacementChange={setPlacement}
							onInsertBlock={insertBlock}
							activePageNumber={layoutDraft.pages.findIndex((p) => p.id === activePageId) + 1}
							pageCount={layoutDraft.pages.length}
							onAddPage={handleAddPage}
							onDeletePage={handleDeletePage}
							canDeletePage={layoutDraft.pages.length > 1}
						/>
					</div>

					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex flex-none items-center justify-between border-b border-[var(--line)] px-4 py-2">
							<div className="w-[140px]">
								<Select
									label="Zoom"
									value={zoom}
									onChange={(value) => setZoom(value as ZoomChoice)}
									options={ZOOM_OPTIONS}
								/>
							</div>
							<span className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{layoutDraft.pages.length} {layoutDraft.pages.length === 1 ? "page" : "pages"}
							</span>
						</div>
						<div className="min-h-0 flex-1">
							<PageCanvas
								layout={layoutDraft}
								zoom={zoom === "fit" ? "fit" : Number(zoom)}
								selection={selection}
								onSelect={setSelection}
								activePageId={activePageId}
								onActivatePage={setActivePageId}
								onMoveBox={moveBox}
							/>
						</div>
					</div>

					<div className="w-[300px] flex-none">
						<Inspector
							target={inspectorTarget}
							onUpdateBlock={updateSelectedContent}
							onMoveBlock={moveSelectedBlock}
							onUpdateBoxPosition={updateSelectedBoxPosition}
							onDelete={deleteSelected}
						/>
					</div>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
					<div className="mx-auto w-full max-w-[var(--content-width)]">
						<div className="grid grid-cols-2 gap-4">
							<Field label="Name" required value={name} onChange={setName} error={nameError} />
							<Field label="Description" value={description} onChange={setDescription} />
						</div>

						<section className="mt-10">
							<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
								Inputs
							</h3>
							<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								What this template asks for beyond a client and a project.
							</p>
							<div className="mt-4">
								<TemplateInputsEditor inputs={inputsDraft} onChange={setInputsDraft} />
							</div>
						</section>

						<section className="mt-10">
							<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
								Placeholders
							</h3>
							<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								As of the last save.
							</p>
							{current.placeholders.length === 0 ? (
								<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									This template refers to no values.
								</p>
							) : (
								<ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
									{current.placeholders.map((path) => (
										<li
											key={path}
											data-selectable
											className="text-[length:var(--text-dense)] text-[var(--ink-muted)]"
											style={{ fontFamily: "var(--font-mono)" }}
										>
											{path}
										</li>
									))}
								</ul>
							)}
						</section>

						<section className="mt-10">
							<div className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-2">
								<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Preview</h3>
								<div className="flex items-end gap-2">
									<div className="w-[220px]">
										<Select
											label="Against client"
											value={previewClientId}
											onChange={setPreviewClientId}
											placeholder="No client"
											options={clients.map((row) => ({ value: row.id, label: row.name }))}
										/>
									</div>
									<Button disabled={preview.status === "running" || dirty} onClick={() => void runPreview()}>
										{preview.status === "running" ? "Rendering" : "Refresh preview"}
									</Button>
								</div>
							</div>

							{dirty ? (
								<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									Save your changes to preview them. The preview shows what was last saved.
								</p>
							) : null}

							{preview.status === "idle" ? (
								<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									Refresh the preview to render the last saved layout.
								</p>
							) : preview.status === "running" ? (
								<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">Rendering.</p>
							) : preview.status === "error" ? (
								<p
									data-selectable
									className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
								>
									{preview.message}
								</p>
							) : (
								<>
									{preview.missing.length > 0 ? (
										<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											Missing here: {preview.missing.join(", ")}
										</p>
									) : null}
									<iframe
										title="Template preview"
										sandbox=""
										referrerPolicy="no-referrer"
										srcDoc={preview.html}
										className="mt-4 h-[520px] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
									/>
								</>
							)}
						</section>
					</div>
				</div>
			)}

			{confirmDialogs}
		</div>
	);
}
