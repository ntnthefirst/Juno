import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "@shared/blocks";
import type { DocumentRecord, PageDetail } from "@shared/types";
import { BlockEditor } from "../../components/BlockEditor";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { FindBar } from "../../components/FindBar";
import { MenuButton } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { COMBOS, matchesCombo } from "../../lib/shortcuts";
import { editedLabel } from "../notes/note-format";
import { useFind } from "../notes/use-find";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "./DocumentOwnerFields";

type PageViewProps = {
	pageId: string;
	onDeleted: (record: DocumentRecord) => void;
	onChanged: () => void;
	/** The screen shows this in the title bar trail. */
	onTitleChange: (title: string) => void;
};

/** A moment of quiet after typing before the page is written, as a note's is. */
const SAVE_AFTER_MS = 500;

type Load = { status: "loading" } | { status: "ready"; page: PageDetail } | { status: "error"; message: string };

/**
 * A page open. It reads like a document, a title, a line saying what it is and
 * where it is kept, then blocks, and it is saved as it is typed (the blocks go
 * out a moment after typing stops and again when the page is left). Ctrl F opens
 * the same find bar a message has.
 */
export function PageView({ pageId, onDeleted, onChanged, onTitleChange }: PageViewProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		window.juno.pages
			.get(pageId)
			.then((page) => {
				if (!cancelled) setLoad({ status: "ready", page });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [pageId]);

	if (load.status === "loading") return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;
	if (load.status === "error") {
		return (
			<div className="m-8 border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not open this page.</p>
				<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}
	return <PageEditor initial={load.page} onDeleted={onDeleted} onChanged={onChanged} onTitleChange={onTitleChange} />;
}

type PageEditorProps = {
	initial: PageDetail;
	onDeleted: (record: DocumentRecord) => void;
	onChanged: () => void;
	onTitleChange: (title: string) => void;
};

function PageEditor({ initial, onDeleted, onChanged, onTitleChange }: PageEditorProps) {
	const id = initial.document.id;
	const [record, setRecord] = useState(initial.document);
	const [title, setTitle] = useState(initial.document.title);
	const [blocks, setBlocks] = useState<Block[]>(initial.blocks.length > 0 ? initial.blocks : []);
	const [error, setError] = useState<string | null>(null);
	const [finding, setFinding] = useState(false);
	const [query, setQuery] = useState("");
	const [moving, setMoving] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const area = useRef<HTMLDivElement>(null);
	const draft = useRef<{ title: string; blocks: Block[] } | null>(null);
	const timer = useRef<number | null>(null);
	const callbacks = useRef({ onChanged, onTitleChange });
	useEffect(() => {
		callbacks.current = { onChanged, onTitleChange };
	});

	useEffect(() => {
		callbacks.current.onTitleChange(title || "Untitled page");
	}, [title]);

	const flush = useCallback(() => {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = null;
		const pending = draft.current;
		if (!pending) return;
		draft.current = null;
		window.juno.pages
			.update(id, { title: pending.title, blocks: pending.blocks })
			.then((page) => {
				setRecord((before) => ({ ...before, updatedAt: page.document.updatedAt }));
				callbacks.current.onChanged();
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, [id]);

	useEffect(() => flush, [flush]);

	function schedule(next: { title: string; blocks: Block[] }) {
		draft.current = next;
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, SAVE_AFTER_MS);
	}

	// An empty page shows one line to type in.
	const shown = blocks.length > 0 ? blocks : [{ id: "first", type: "text" as const, text: "" }];

	const find = useFind(area, query, finding, blocks);

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (matchesCombo(event, COMBOS.find)) {
				event.preventDefault();
				setFinding(true);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	async function relink(next: DocumentOwnerChoice) {
		try {
			const page = await window.juno.pages.update(id, { clientId: next.clientId || null, projectId: next.projectId || null });
			setRecord(page.document);
			onChanged();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	async function remove() {
		setConfirmingDelete(false);
		flush();
		try {
			onDeleted(await window.juno.documents.remove(id));
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const where = [record.clientName, record.projectName].filter(Boolean).join(" · ");

	return (
		<div className="relative h-full overflow-y-auto">
			{finding ? (
				<div className="pointer-events-none sticky top-3 z-30 flex justify-end pr-6">
					<div className="pointer-events-auto">
						<FindBar
							query={query}
							onQueryChange={setQuery}
							count={find.count}
							current={find.current}
							onNext={find.next}
							onPrevious={find.previous}
							onClose={() => {
								setFinding(false);
								setQuery("");
							}}
						/>
					</div>
				</div>
			) : null}
			<div className="mx-auto w-full max-w-[720px] px-6 pt-8 pb-32">
				<BlockEditor
					blocks={shown}
					variant="page"
					header={
						<>
						<input
							value={title}
							onChange={(event) => {
								setTitle(event.target.value);
								schedule({ title: event.target.value, blocks });
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									area.current?.querySelector<HTMLElement>("[data-block-text]")?.focus();
								}
							}}
							placeholder="Untitled page"
							aria-label="Title"
							className="block w-full bg-transparent text-h1 text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
						/>
						<div className="mt-2 mb-6 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
							<span className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--accent)]">
								Page
							</span>
							{where ? <span>{where}</span> : null}
							<span className="tabular">{editedLabel(record.updatedAt)}</span>
							<span className="ml-auto">
								<MenuButton
									ariaLabel="More page actions"
									items={[
										{ id: "find", label: "Find in page", icon: "search", hint: "Ctrl F", onSelect: () => setFinding(true) },
										{ id: "move", label: "Change client or project", icon: "projects", onSelect: () => setMoving(true) },
										{ id: "delete", label: "Delete", icon: "remove", danger: true, separatorBefore: true, onSelect: () => setConfirmingDelete(true) },
									]}
								/>
							</span>
						</div>
						{error ? (
							<p role="alert" data-selectable className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
								{error}
							</p>
						) : null}
						</>
					}
					containerRef={area}
					onChange={(next) => {
						setBlocks(next);
						schedule({ title, blocks: next });
					}}
				/>
			</div>

			{moving ? (
				<Dialog title="Where this page is kept" width="narrow" onClose={() => setMoving(false)}>
					<DocumentOwnerFields
						value={{ clientId: record.clientId ?? "", projectId: record.projectId ?? "" }}
						onChange={(next) => void relink(next)}
					/>
					<div className="mt-4 flex justify-end">
						<Button variant="primary" onClick={() => setMoving(false)}>
							Done
						</Button>
					</div>
				</Dialog>
			) : null}

			{confirmingDelete ? (
				<Dialog title="Delete page" width="narrow" onClose={() => setConfirmingDelete(false)}>
					<p className="text-base text-[var(--ink)]">Delete this page? You can undo it right after.</p>
					<div className="mt-4 flex justify-end gap-2">
						<Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
						<Button variant="danger" onClick={() => void remove()}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
