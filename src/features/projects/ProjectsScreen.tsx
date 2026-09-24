import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, ProjectSummary, ProjectsView, ReferenceItem } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { AddButton } from "../../components/AddButton";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { ProjectDetail } from "./ProjectDetail";
import { ProjectForm } from "./ProjectForm";
import { ProjectGrid } from "./ProjectGrid";
import { ProjectTable } from "./ProjectTable";
import { ViewControls } from "./ViewControls";

type Rows = { projects: ProjectSummary[]; statuses: ReferenceItem[] };

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: Rows }
	| { status: "error"; message: string };

/** Sorting is a view concern, so it happens here rather than in the service. */
function sortRows(rows: ProjectSummary[], sort: ProjectsView["sort"]): ProjectSummary[] {
	const copy = [...rows];
	const byName = (a: ProjectSummary, b: ProjectSummary) =>
		a.name.localeCompare(b.name, "nl-BE", { sensitivity: "base" });

	switch (sort) {
		case "name":
			return copy.sort(byName);
		case "client":
			return copy.sort((a, b) => {
				// Projects with no client collect at the end rather than under an
				// empty heading at the top.
				const left = a.clientName ?? "￿";
				const right = b.clientName ?? "￿";
				return left.localeCompare(right, "nl-BE", { sensitivity: "base" }) || byName(a, b);
			});
		case "recent":
			// Newest first. `updatedAt` is a UTC ISO-8601 string, so it compares
			// as text without being parsed into a Date.
			return copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
		default:
			// The service already orders by due date and then name, which is what
			// the deadline sort wants, so the common case does no work here.
			return copy;
	}
}

function matches(row: ProjectSummary, needle: string): boolean {
	if (!needle) return true;
	const haystack = [row.name, row.clientName ?? "", row.description ?? "", row.localPath ?? ""]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

export function ProjectsScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [view, setView] = useState<ProjectsView | null>(null);
	const [term, setTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Seeded from the clicked row so the trail never flashes empty, then kept
	// current by ProjectDetail once the real record has loaded.
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [detailVersion, setDetailVersion] = useState(0);
	const [editing, setEditing] = useState<Project | null | "new">(null);
	const [deleted, setDeleted] = useState<ProjectSummary | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const fetchRows = useCallback(async (): Promise<Rows> => {
		const [projects, statusSet] = await Promise.all([
			window.juno.projects.list(),
			window.juno.reference.getSet("project_status"),
		]);
		return { projects, statuses: statusSet ? statusSet.items : [] };
	}, []);

	useEffect(() => {
		let cancelled = false;
		Promise.all([fetchRows(), window.juno.settings.getProjectsView()])
			.then(([rows, stored]) => {
				if (cancelled) return;
				setView(stored);
				setLoad({ status: "ready", rows });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchRows]);

	const refreshList = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [fetchRows]);

	const clearSelection = useCallback(() => {
		setSelectedId(null);
		setSelectedName(null);
	}, []);

	// The view is written through so it survives a restart, and applied
	// optimistically so the layout does not wait on a file write to change.
	function changeView(patch: Partial<ProjectsView>) {
		setView((current) => (current ? { ...current, ...patch } : current));
		void window.juno.settings
			.setProjectsView(patch)
			.then(setView)
			.catch((cause: unknown) => setNotice(messageOf(cause)));
	}

	function open(project: ProjectSummary) {
		setSelectedId(project.id);
		setSelectedName(project.name);
	}

	async function remove(project: ProjectSummary) {
		try {
			await window.juno.projects.remove(project.id);
			clearSelection();
			setDeleted(project);
			refreshList();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function restore() {
		if (!deleted) return;
		const project = deleted;
		setDeleted(null);
		try {
			await window.juno.projects.restore(project.id);
			refreshList();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function openFolder(project: ProjectSummary) {
		try {
			await window.juno.projects.openLocalFolder(project.id);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function saved(project: Project) {
		setEditing(null);
		setSelectedId(project.id);
		setSelectedName(project.name);
		setDetailVersion((version) => version + 1);
		refreshList();
	}

	// Escape backs out of the open record, same as a FormPage, but only when
	// nothing floats above it: a dialog on top handles Escape itself, and
	// without this guard both would fire.
	useEffect(() => {
		if (selectedId === null || editing !== null) return;
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			clearSelection();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedId, editing, clearSelection]);

	const rows = load.status === "ready" ? load.rows : null;
	const needle = term.trim().toLowerCase();
	const shown = useMemo(() => {
		if (!rows || !view) return [];
		return sortRows(
			rows.projects.filter(
				(row) => matches(row, needle) && (!statusFilter || row.status?.id === statusFilter),
			),
			view.sort,
		);
	}, [rows, view, needle, statusFilter]);

	usePublishBreadcrumb(
		editing !== null
			? [
					{ label: "Projects", onSelect: () => setEditing(null) },
					{ label: editing === "new" ? "New project" : "Edit project" },
				]
			: selectedId !== null
				? [{ label: "Projects", onSelect: clearSelection }, { label: selectedName ?? "Project" }]
				: [],
	);

	if (editing !== null) {
		return (
			<ProjectForm
				project={editing === "new" ? null : editing}
				onClose={() => setEditing(null)}
				onSaved={saved}
			/>
		);
	}

	if (selectedId !== null) {
		return (
			<ProjectDetail
				key={`${selectedId}:${detailVersion}`}
				projectId={selectedId}
				onBack={clearSelection}
				onChanged={refreshList}
				onEdit={(project) => setEditing(project)}
				onNameChange={setSelectedName}
				onDeleted={(project) => {
					clearSelection();
					setDeleted(project);
					refreshList();
				}}
			/>
		);
	}

	return (
		<div className="flex h-full flex-col p-8">
			<div className="mx-auto mb-6 flex w-full max-w-[var(--content-width)] flex-col gap-4">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-baseline gap-3">
						<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
							Projects
						</h1>
						{rows ? (
							<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{shown.length} {shown.length === 1 ? "project" : "projects"}
							</span>
						) : null}
					</div>

					<div className="flex items-center gap-2">
						{view ? <ViewControls view={view} onChange={changeView} /> : null}
						<AddButton label="New project" onClick={() => setEditing("new")} />
					</div>
				</div>

				{rows && rows.projects.length > 0 ? (
					<div className="flex items-center gap-2">
						<div className="relative min-w-0 flex-1">
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]">
								<Icon name="search" />
							</span>
							<input
								type="search"
								value={term}
								onChange={(event) => setTerm(event.target.value)}
								aria-label="Search projects"
								placeholder="Search by name, client, description or folder"
								className="h-[36px] w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pl-9 pr-3 text-[length:var(--text-base)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
							/>
						</div>

						<select
							value={statusFilter}
							onChange={(event) => setStatusFilter(event.target.value)}
							aria-label="Filter by status"
							className="h-[36px] rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 text-[length:var(--text-dense)] text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
						>
							<option value="">Every status</option>
							{rows.statuses
								.filter((item) => item.hiddenAt === null)
								.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
						</select>
					</div>
				) : null}
			</div>

			<div className="mx-auto min-h-0 w-full max-w-[var(--content-width)] flex-1 overflow-y-auto">
				{load.status === "loading" || !view ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not load your projects.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{load.message}
						</p>
					</div>
				) : load.rows.projects.length === 0 ? (
					<div className="max-w-[48ch]">
						<h2 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)]">
							No projects yet
						</h2>
						<p className="mt-2 text-[var(--ink-muted)]">
							A project is a piece of work with its files, its links and the command that starts
							it in one place. It can belong to a client, and it does not have to.
						</p>
						<div className="mt-6">
							<Button variant="primary" onClick={() => setEditing("new")}>
								<Icon name="add" />
								New project
							</Button>
						</div>
					</div>
				) : shown.length === 0 ? (
					<p className="text-[var(--ink-muted)]">Nothing matches that. Clear the search to see all of them.</p>
				) : view.layout === "grid" ? (
					<ProjectGrid
						rows={shown}
						size={view.size}
						previews={view.previews}
						onOpen={open}
						onRemove={(project) => void remove(project)}
						onOpenFolder={(project) => void openFolder(project)}
					/>
				) : (
					<ProjectTable
						rows={shown}
						dense={view.layout === "list" || !view.previews}
						onOpen={open}
						onRemove={(project) => void remove(project)}
						onOpenFolder={(project) => void openFolder(project)}
					/>
				)}
			</div>

			{deleted ? (
				<Toast
					message={`${deleted.name} deleted.`}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={() => setDeleted(null)}
				/>
			) : null}

			{deleted === null && notice ? (
				<Toast message={notice} onDismiss={() => setNotice(null)} />
			) : null}
		</div>
	);
}
