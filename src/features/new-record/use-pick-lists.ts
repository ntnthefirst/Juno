import { useEffect, useState } from "react";
import type { ClientSummary, ProjectSummary } from "@shared/types";
import { messageOf } from "../../lib/errors";

/**
 * The clients and projects a new-record window offers as owners, read once when
 * the window opens. `error` is set when the read fails, for the window's own
 * error line.
 */
export function usePickLists(): { clients: ClientSummary[]; projects: ProjectSummary[]; error: string | null } {
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.clients.list(), window.juno.projects.list()])
			.then(([clientRows, projectRows]) => {
				if (cancelled) return;
				setClients(clientRows);
				setProjects(projectRows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(`Could not load your clients. ${messageOf(cause)}`);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return { clients, projects, error };
}
