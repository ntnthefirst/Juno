import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { parseMarkdown, toMarkdown, type Block } from "@shared/blocks";
import type { Note, NoteHit, ProjectSummary } from "@shared/types";
import { BlockEditor } from "../../components/BlockEditor";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { Toast } from "../../components/Toast";
import { GroupHeader } from "../../components/GroupHeader";
import { groupByDay } from "../../lib/day-groups";
import { messageOf } from "../../lib/errors";
import { blankMenuFor } from "../../lib/blank-menu";
import { contextMenuFor } from "../../lib/native-menu";
import { clearPending, peekPending } from "../../lib/open-entity";
import { useScreenAction } from "../../lib/screen-actions";
import { useLoaded } from "../../lib/use-loaded";
import { useRecentTouch } from "../../lib/use-recent-touch";
import { editedLabel, groupLabel, noteTitle, notePreview, rowTime } from "./note-format";

const loadNotes = () => window.juno.notes.list();

/** How long typing has to pause before it is written, so a note is saved as it is typed without a write per key. */
const SAVE_AFTER_MS = 500;

type Row = { note: Note; preview: string };

export function NotesScreen() {
	const notes = useLoaded(loadNotes);
	const [selectedId, setSelectedId] = useState<string | null>(() => peekPending("note")?.id ?? null);
	useEffect(() => clearPending, []);
	const [search, setSearch] = useState("");
	const [hits, setHits] = useState<{ term: string; rows: NoteHit[] } | null>(null);
	const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null);
	const [moving, setMoving] = useState<Note | null>(null);
	const [focusTitle, setFocusTitle] = useState(false);
	

	const reload = notes.reload;
	const term = search.trim();

	useEffect(() => {
		if (term === "") return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			window.juno.notes
				.search(term)
				.then((rows) => {
					if (!cancelled) setHits({ term, rows });
				})
				.catch((cause: unknown) => {
					if (!cancelled) setNotice({ message: messageOf(cause) });
				});
		}, 180);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [term]);

	const create = useCallback(async () => {
		try {
			const note = await window.juno.notes.create({});
			setSearch("");
			setSelectedId(note.id);
			setFocusTitle(true);
			reload();
		} catch (cause: unknown) {
			setNotice({ message: messageOf(cause) });
		}
	}, [reload]);
	useScreenAction("notes", () => void create());

	const all = notes.status === "ready" ? notes.value : null;
	const searching = term !== "";
	const rows = useMemo<Row[]>(() => {
		if (!all) return [];
		if (!searching) return all.map((note) => ({ note, preview: notePreview(note) }));
		if (hits?.term !== term) return [];
		return hits.rows.map((hit) => ({ note: hit.note, preview: hit.snippet }));
	}, [all, searching, hits, term]);

	// The first note opens when nothing is chosen, so the screen is never a list beside a blank page.
	const openId = selectedId ?? (!searching && all && all.length > 0 ? all[0]!.id : null);
	const selected = all?.find((note) => note.id === openId) ?? null;
	useRecentTouch("note", selected?.id ?? null);

	async function remove(note: Note) {
		try {
			await window.juno.notes.remove(note.id);
			if (openId === note.id) setSelectedId(null);
			setNotice({
				message: "Note deleted.",
				undo: () => {
					void window.juno.notes
						.restore(note.id)
						.then(() => {
							setSelectedId(note.id);
							reload();
						})
						.catch((cause: unknown) => setNotice({ message: messageOf(cause) }));
				},
			});
			reload();
		} catch (cause: unknown) {
			setNotice({ message: messageOf(cause) });
		}
	}

	async function duplicate(note: Note) {
		try {
			const copy = await window.juno.notes.duplicate(note.id);
			setSelectedId(copy.id);
			reload();
		} catch (cause: unknown) {
			setNotice({ message: messageOf(cause) });
		}
	}

	function onRowKey(event: KeyboardEvent, note: Note) {
		if (event.key === "Delete") {
			event.preventDefault();
			void remove(note);
		} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
			event.preventDefault();
			void duplicate(note);
		}
	}

	const groups = useMemo(() => (searching ? null : groupByDay(rows, (row) => row.note.updatedAt)), [rows, searching]);

	function renderRow({ note, preview }: Row) {
		const open = note.id === openId;
		return (
			<button
				key={note.id}
				type="button"
				aria-current={open ? "true" : undefined}
				onClick={() => setSelectedId(note.id)}
				onKeyDown={(event) => onRowKey(event, note)}
				onContextMenu={contextMenuFor(
					{ kind: "note", id: note.id },
					{
						delete: () => void remove(note),
						"move-to-project": () => setMoving(note),
						done: (message) => {
							if (message) setNotice({ message });
							reload();
						},
						failed: (message) => setNotice({ message }),
					},
				)}
				className={[
					"flex h-[72px] w-full flex-none flex-col items-start gap-[2px] overflow-hidden rounded-[var(--radius-md)] px-3 py-[10px] text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
					open ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]/60",
				].join(" ")}
			>
				<span className="flex w-full items-center gap-1 text-base font-[var(--weight-semibold)] text-[var(--ink)]">
					<span className="min-w-0 flex-1 truncate">{noteTitle(note)}</span>
					{note.pinnedAt ? <Icon name="flag" size={12} className="flex-none text-[var(--ink-muted)]" /> : null}
				</span>
				<span className="flex w-full gap-2 text-dense text-[var(--ink-muted)]">
					<span className="tabular flex-none">{rowTime(note.updatedAt)}</span>
					<span className="min-w-0 flex-1 truncate">{preview}</span>
				</span>
			</button>
		);
	}

	const empty = all !== null && all.length === 0 && !searching;

	return (
		<div className="flex h-full min-h-0" onContextMenu={blankMenuFor("notes")}>
			<aside
				aria-label="Notes list"
				className={["flex w-[320px] flex-none flex-col border-r border-[var(--line)]", empty ? "hidden" : ""].join(" ")}
			>
				<div className="flex items-baseline gap-2 px-6 pt-6 pb-3">
					<h1 className="text-h2 text-[var(--ink)]">Notes</h1>
					{all ? <span className="tabular text-base text-[var(--ink-muted)]">{all.length}</span> : null}
				</div>
				<div className="px-4 pb-3">
					<label className="flex h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--sunken)] px-3 text-[var(--ink-muted)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)]">
						<Icon name="search" size={16} />
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") setSearch("");
							}}
							placeholder="Search notes"
							aria-label="Search notes"
							className="min-w-0 flex-1 bg-transparent text-dense text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
						/>
					</label>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
					{notes.status === "loading" ? <p className="px-4 text-dense text-[var(--ink-muted)]">Loading.</p> : null}
					{notes.status === "error" ? (
						<p data-selectable className="px-4 text-dense text-[var(--risk)]">
							{notes.message}
						</p>
					) : null}
					{searching && hits?.term === term && rows.length === 0 ? (
						<p className="px-4 py-3 text-dense text-[var(--ink-muted)]">Nothing matches that.</p>
					) : null}
					{groups
						? groups.map((group) => (
								<section key={group.key} aria-label={groupLabel(group.label)} className="mb-2">
									<GroupHeader label={groupLabel(group.label)} className="px-4" />
									{group.items.map(renderRow)}
								</section>
							))
						: rows.map(renderRow)}
				</div>
			</aside>

			<section aria-label="Note" className="min-w-0 flex-1 overflow-y-auto">
				{empty ? (
					<EmptyState
						icon="note"
						title="No notes yet"
						description="Write down a checklist, a price list or an idea. Notes stay on this computer."
						action={{ label: "New note", icon: "add", onClick: () => void create() }}
					/>
				) : selected ? (
					<NoteEditor
						key={selected.id}
						note={selected}
						focusTitle={focusTitle}
						onFocused={() => setFocusTitle(false)}
						onSaved={reload}
						onError={(message) => setNotice({ message })}
					/>
				) : null}
			</section>

			{moving ? (
				<MoveDialog
					note={moving}
					onClose={() => setMoving(null)}
					onMoved={() => {
						setMoving(null);
						reload();
					}}
					onError={(message) => setNotice({ message })}
				/>
			) : null}

			{notice ? (
				<Toast
					message={notice.message}
					{...(notice.undo ? { actionLabel: "Undo", onAction: notice.undo } : {})}
					onDismiss={() => setNotice(null)}
				/>
			) : null}
		</div>
	);
}

type NoteEditorProps = {
	note: Note;
	focusTitle: boolean;
	onFocused: () => void;
	onSaved: () => void;
	onError: (message: string) => void;
};

/**
 * One note open. It keeps the words it is typing in itself and writes them a
 * moment after typing stops, and again when it goes away, so switching to
 * another note or leaving the screen never loses the last keystrokes.
 */
function NoteEditor({ note, focusTitle, onFocused, onSaved, onError }: NoteEditorProps) {
	const [title, setTitle] = useState(note.title);
	const [blocks, setBlocks] = useState<Block[]>(() => {
		const parsed = parseMarkdown(note.body);
		return parsed.length > 0 ? parsed : parseMarkdown("");
	});
	const draft = useRef<{ title: string; body: string } | null>(null);
	const timer = useRef<number | null>(null);
	const titleInput = useRef<HTMLInputElement>(null);
	const area = useRef<HTMLDivElement>(null);
	const saved = useRef({ onSaved, onError });
	useEffect(() => {
		saved.current = { onSaved, onError };
	});

	const flush = useCallback(() => {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = null;
		const pending = draft.current;
		if (!pending) return;
		draft.current = null;
		window.juno.notes
			.update(note.id, pending)
			.then(() => saved.current.onSaved())
			.catch((cause: unknown) => saved.current.onError(messageOf(cause)));
	}, [note.id]);

	const schedule = useCallback(
		(next: { title: string; body: string }) => {
			draft.current = next;
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = window.setTimeout(flush, SAVE_AFTER_MS);
		},
		[flush],
	);

	useEffect(() => flush, [flush]);

	useEffect(() => {
		if (!focusTitle) return;
		titleInput.current?.focus();
		onFocused();
	}, [focusTitle, onFocused]);

	function changeBlocks(next: Block[]) {
		setBlocks(next);
		schedule({ title, body: toMarkdown(next) });
	}

	function changeTitle(next: string) {
		setTitle(next);
		schedule({ title: next, body: toMarkdown(blocks) });
	}

	const owner = [note.clientName, note.projectName].filter(Boolean).join(" · ");

	return (
		<div className="mx-auto w-full max-w-[860px] px-14 pt-16 pb-24">
			<input
				ref={titleInput}
				value={title}
				onChange={(event) => changeTitle(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						area.current?.querySelector<HTMLElement>("[data-block-text]")?.focus();
					}
				}}
				placeholder="Untitled"
				aria-label="Title"
				className="block w-full bg-transparent text-h1 text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
			/>
			<p className="mt-2 mb-6 text-sm text-[var(--ink-muted)]">
				<span className="tabular">{editedLabel(note.updatedAt)}</span>
				{owner ? ` · ${owner}` : ""}
			</p>
			<BlockEditor blocks={blocks} onChange={changeBlocks} variant="note" containerRef={area} />
		</div>
	);
}

type MoveDialogProps = {
	note: Note;
	onClose: () => void;
	onMoved: () => void;
	onError: (message: string) => void;
};

/** Which project a note belongs to. A project with a client does not change the note's client. */
function MoveDialog({ note, onClose, onMoved, onError }: MoveDialogProps) {
	const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
	const [projectId, setProjectId] = useState(note.projectId ?? "");

	useEffect(() => {
		window.juno.projects
			.list()
			.then((list) => setProjects(list))
			.catch((cause: unknown) => onError(messageOf(cause)));
	}, [onError]);

	async function move() {
		try {
			await window.juno.notes.update(note.id, { projectId: projectId === "" ? null : projectId });
			onMoved();
		} catch (cause: unknown) {
			onError(messageOf(cause));
		}
	}

	return (
		<Dialog title="Move to a project" onClose={onClose} width="narrow">
			<Select
				label="Project"
				value={projectId}
				onChange={setProjectId}
				options={(projects ?? []).map((project) => ({ value: project.id, label: project.name }))}
				placeholder="No project"
			/>
			<div className="mt-4 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="primary" onClick={() => void move()}>
					Move
				</Button>
			</div>
		</Dialog>
	);
}
