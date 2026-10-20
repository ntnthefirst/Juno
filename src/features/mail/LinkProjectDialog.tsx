import { useEffect, useState } from "react";
import type { MailThreadSummary, ProjectSummary } from "@shared/types";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type LinkProjectDialogProps = {
	thread: MailThreadSummary;
	onClose: () => void;
	onLinked: () => void;
};

/** Every word typed appears in the project's name or its client's. */
function matches(project: ProjectSummary, search: string): boolean {
	const haystack = `${project.name} ${project.clientName ?? ""}`.toLowerCase();
	return search
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}

/**
 * Files a conversation under a job. Picking is the answer: there is nothing
 * else to decide, so there is no second step. The thread's client is not
 * touched, which is what lets a supplier's mail about a client's kitchen be
 * filed under the kitchen. A thread that has a client is offered that client's
 * projects and the owner's own, because the service refuses another client's.
 */
export function LinkProjectDialog({ thread, onClose, onLinked }: LinkProjectDialogProps) {
	const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.projects
			.list()
			.then((rows) => {
				if (cancelled) return;
				setProjects(
					thread.clientId
						? rows.filter((project) => project.clientId === thread.clientId || project.clientId === null)
						: rows,
				);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [thread.clientId]);

	async function pick(project: ProjectSummary) {
		setBusy(true);
		setError(null);
		try {
			await window.juno.mail.threads.linkProject(thread.id, project.id);
			onLinked();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	const found = (projects ?? []).filter((project) => matches(project, search));
	// The client's own jobs first: that is where a conversation with them belongs.
	const ordered = [
		...found.filter((project) => thread.clientId !== null && project.clientId === thread.clientId),
		...found.filter((project) => thread.clientId === null || project.clientId !== thread.clientId),
	];

	return (
		<Dialog title="File under a project" onClose={onClose} width="narrow">
			<input
				type="search"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				placeholder="Search projects"
				aria-label="Search projects"
				autoFocus
				className="mt-4 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
			/>
			{error ? (
				<p role="alert" data-selectable className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
			<ul className="mt-3 max-h-[320px] overflow-y-auto">
				{projects === null ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">Loading.</li>
				) : ordered.length === 0 ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">
						{projects.length === 0
							? thread.clientName
								? `${thread.clientName} has no projects yet.`
								: "There are no projects yet."
							: "No project matches."}
					</li>
				) : (
					ordered.map((project) => (
						<li key={project.id}>
							<button
								type="button"
								disabled={busy}
								onClick={() => void pick(project)}
								style={{ height: "var(--row-height)" }}
								className={[
									"flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
									project.id === thread.projectId ? "text-[var(--accent)]" : "",
								].join(" ")}
							>
								<span className="truncate">{project.name}</span>
								<span className="shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{project.clientName ?? "Your own"}
								</span>
							</button>
						</li>
					))
				)}
			</ul>
		</Dialog>
	);
}
