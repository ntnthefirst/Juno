import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, ProjectSummary, ProjectsView, ReferenceItem, TimeEntry } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { TitleSearch } from "../../app/TitleSearch";
import { blankMenuFor } from "../../lib/blank-menu";
import { openNewRecord, useRecordsChanged } from "../../lib/new-record";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { SelectionBar } from "../../components/SelectionBar";
import { Toast } from "../../components/Toast";
import { useRowSelection } from "../../lib/use-row-selection";
import { clearPending, peekPending } from "../../lib/open-entity";
import { messageOf } from "../../lib/errors";
import { useRecentTouch } from "../../lib/use-recent-touch";
import { ScheduleFormPage } from "../calendar/ScheduleFormPage";
import { scheduleFormLabel, type ScheduleForm } from "../calendar/schedule-form";
import { GenerateDialog } from "../documents/GenerateDialog";
import { ProjectDetail, type ProjectTab } from "./ProjectDetail";
import { ProjectForm } from "./ProjectForm";
import { ProjectGrid } from "./ProjectGrid";
import { ProjectTable } from "./ProjectTable";
import { TimeEntryFormPage } from "./TimeEntryFormPage";
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
	const [selectedId, setSelectedId] = useState<string | null>(() => peekPending("project")?.id ?? null);
	// Seeded from the clicked row so the trail never flashes empty, then kept
	// current by ProjectDetail once the real record has loaded.
	const [selectedName, setSelectedName] = useState<string | null>(() => peekPending("project")?.name ?? null);
	useEffect(() => clearPending, []);
	useRecentTouch("project", selectedId);
	const [detailVersion, setDetailVersion] = useState(0);
	const [editing, setEditing] = useState<Project | null>(null);
	const [scheduleForm, setScheduleForm] = useState<ScheduleForm | null>(null);
	// A time entry is a form too: null is closed, an entry of null is a new one.
	const [timeForm, setTimeForm] = useState<{ entry: TimeEntry | null } | null>(null);
	const [tab, setTab] = useState<ProjectTab>("notes");
	// A document from a template is a page of its own, the same as on a client.
	const [generating, setGenerating] = useState(false);
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

	// A new-record window saved something: the list and the open project read again.
	useRecordsChanged(() => {
		refreshList();
		setDetailVersion((version) => version + 1);
	});

	const clearSelection = useCallback(() => {
		setSelectedId(null);
		setSelectedName(null);
		setTab("notes");
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
		setTab("notes");
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
		if (selectedId === null || editing !== null || scheduleForm !== null || timeForm !== null || generating) return;
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			clearSelection();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedId, editing, scheduleForm, timeForm, generating, clearSelection]);

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
	const shownIds = useMemo(() => shown.map((row) => row.id), [shown]);
	const selection = useRowSelection(shownIds);
	// A delete of several asks first, and is undone as one.
	const [confirmingDelete, setConfirmingDelete] = useState<string[] | null>(null);
	const [deletedMany, setDeletedMany] = useState<Project[] | null>(null);

	async function archiveSelected(ids: string[]) {
		try {
			const archived = await window.juno.projects.archiveMany(ids);
			setNotice(archived.length === 1 ? `${archived[0]!.name} archived.` : `${archived.length} projects archived.`);
			selection.clear();
			refreshList();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function deleteSelected(ids: string[]) {
		setConfirmingDelete(null);
		try {
			const removed = await window.juno.projects.removeMany(ids);
			selection.clear();
			setDeleted(null);
			setDeletedMany(removed);
			refreshList();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function restoreMany() {
		if (!deletedMany) return;
		const ids = deletedMany.map((project) => project.id);
		setDeletedMany(null);
		try {
			await window.juno.projects.restoreMany(ids);
			refreshList();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	usePublishBreadcrumb(
		editing !== null
			? [
					{ label: "Projects", onSelect: () => setEditing(null) },
					{ label: "Edit project" },
				]
			: selectedId !== null && generating
				? [
						{ label: "Projects", onSelect: clearSelection },
						{ label: selectedName ?? "Project", onSelect: () => setGenerating(false) },
						{ label: "New document" },
					]
				: selectedId !== null && timeForm !== null
				? [
						{ label: "Projects", onSelect: clearSelection },
						{ label: selectedName ?? "Project", onSelect: () => setTimeForm(null) },
						{ label: timeForm.entry ? "Edit time entry" : "Add time entry" },
					]
				: selectedId !== null && scheduleForm !== null
				? [
						{ label: "Projects", onSelect: clearSelection },
						{ label: selectedName ?? "Project", onSelect: () => setScheduleForm(null) },
						{ label: scheduleFormLabel(scheduleForm) },
					]
				: selectedId !== null
					? [{ label: "Projects", onSelect: clearSelection }, { label: selectedName ?? "Project" }]
					: [],
	);

	if (editing !== null) {
		return (
			<ProjectForm
				project={editing}
				onClose={() => setEditing(null)}
				onSaved={saved}
			/>
		);
	}

	if (selectedId !== null && generating) {
		return (
			<GenerateDialog
				lockedProjectId={selectedId}
				backLabel="Project"
				onClose={() => setGenerating(false)}
				onGenerated={() => {
					setGenerating(false);
					setDetailVersion((version) => version + 1);
				}}
			/>
		);
	}

	if (selectedId !== null && timeForm !== null) {
		return (
			<TimeEntryFormPage
				projectId={selectedId}
				entry={timeForm.entry}
				backLabel="Project"
				onClose={() => setTimeForm(null)}
				onSaved={() => {
					setTimeForm(null);
					setTab("time");
					setDetailVersion((version) => version + 1);
				}}
			/>
		);
	}

	if (selectedId !== null && scheduleForm !== null) {
		return (
			<ScheduleFormPage
				form={scheduleForm}
				backLabel="Project"
				onClose={() => setScheduleForm(null)}
				onSaved={() => {
					setScheduleForm(null);
					setTab("calendar");
					setDetailVersion((version) => version + 1);
				}}
			/>
		);
	}

	if (selectedId !== null) {
		return (
			<ProjectDetail
				key={`${selectedId}:${detailVersion}`}
				projectId={selectedId}
				tab={tab}
				onTabChange={setTab}
				onBack={clearSelection}
				onChanged={refreshList}
				onEdit={(project) => setEditing(project)}
				onSchedule={setScheduleForm}
				onGenerateDocument={() => setGenerating(true)}
				onTimeForm={(entry) => setTimeForm({ entry })}
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
		<div className="flex h-full flex-col px-6 py-8 lg:px-8 xl:px-10">
			<TitleSearch value={term} onChange={setTerm} placeholder="Search projects" />
			<div className="mb-6 flex w-full flex-col gap-4">
				{view ? <ViewControls view={view} onChange={changeView} /> : null}

				{rows && rows.projects.length > 0 ? (
					<div className="flex items-center gap-2">
						<select
							value={statusFilter}
							onChange={(event) => setStatusFilter(event.target.value)}
							aria-label="Filter by status"
							className="h-[36px] rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 text-dense text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
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

			{selection.selectedIds.length > 0 && shown.length > 0 ? (
				<div className="mb-6">
					<SelectionBar
						count={selection.selectedIds.length}
						allSelected={selection.allSelected}
						onSelectAll={selection.selectAll}
						onClear={selection.clear}
						actions={[
							{
								id: "archive",
								icon: "archive",
								label: "Archive",
								onSelect: () => void archiveSelected(selection.selectedIds),
							},
							{
								id: "delete",
								icon: "remove",
								label: "Delete",
								danger: true,
								onSelect: () => setConfirmingDelete(selection.selectedIds),
							},
						]}
					/>
				</div>
			) : null}

			<div className="min-h-0 w-full flex-1 overflow-y-auto" onContextMenu={blankMenuFor("projects")}>
				{load.status === "loading" || !view ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not load your projects.
						</p>
						<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
							{load.message}
						</p>
					</div>
				) : load.rows.projects.length === 0 ? (
					<EmptyState
						icon="projects"
						title="No projects yet"
						description="A piece of work with its files, its links, its notes and the command that starts it in one place."
						action={{
							label: "Add project",
							icon: "add",
							onClick: () => openNewRecord("project"),
						}}
					/>
				) : shown.length === 0 ? (
					<EmptyState
						title="Nothing matches that"
						description="Clear the search to see all of your projects."
						secondaryAction={{
							label: "Clear search",
							onClick: () => {
								setTerm("");
								setStatusFilter("");
							},
						}}
					/>
				) : view.layout === "grid" ? (
					<ProjectGrid
						rows={shown}
						size={view.size}
						previews={view.previews}
						held={selection.held}
						onPick={selection.pick}
						onOpen={open}
						onRemove={(project) => void remove(project)}
						onFailed={setNotice}
					/>
				) : (
					<ProjectTable
						rows={shown}
						dense={view.layout === "list" || !view.previews}
						held={selection.held}
						onPick={selection.pick}
						onOpen={open}
						onRemove={(project) => void remove(project)}
						onFailed={setNotice}
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

			{deletedMany ? (
				<Toast
					message={
						deletedMany.length === 1 ? `${deletedMany[0]!.name} deleted.` : `${deletedMany.length} projects deleted.`
					}
					actionLabel="Undo"
					onAction={() => void restoreMany()}
					onDismiss={() => setDeletedMany(null)}
				/>
			) : null}

			{deleted === null && deletedMany === null && notice ? (
				<Toast message={notice} onDismiss={() => setNotice(null)} />
			) : null}

			{confirmingDelete ? (
				<Dialog
					title={confirmingDelete.length === 1 ? "Delete 1 project?" : `Delete ${confirmingDelete.length} projects?`}
					width="narrow"
					onClose={() => setConfirmingDelete(null)}
				>
					<p className="mt-3 text-base">
						{confirmingDelete.length === 1 ? "The project is" : `${confirmingDelete.length} projects are`} removed
						from your list. You can undo this straight after.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingDelete(null)}>Cancel</Button>
						<Button variant="danger" onClick={() => void deleteSelected(confirmingDelete)}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
