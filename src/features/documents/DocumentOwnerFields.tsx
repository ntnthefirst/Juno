import { useEffect, useState } from "react";
import type { ClientSummary, ProjectSummary } from "@shared/types";
import { Select } from "../../components/Select";

export type DocumentOwnerChoice = { clientId: string; projectId: string };

type DocumentOwnerFieldsProps = {
	value: DocumentOwnerChoice;
	onChange: (next: DocumentOwnerChoice) => void;
	disabled?: boolean;
	/** The client is fixed, for a document started from that client's page. Its projects stay offered. */
	lockClient?: boolean;
};

/**
 * Where a document is kept: a client, a project, both, or neither.
 *
 * Mirrors the rule in electron/main/services/document-owner.ts so the
 * pickers cannot offer what the service refuses: with a client chosen, only
 * that client's projects are offered; choosing a project that has a client
 * chooses the client too. An empty string is "none" in both.
 */
export function DocumentOwnerFields({ value, onChange, disabled = false, lockClient = false }: DocumentOwnerFieldsProps) {
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [projects, setProjects] = useState<ProjectSummary[]>([]);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.clients.list({ limit: 500 }), window.juno.projects.list()])
			.then(([clientRows, projectRows]) => {
				if (cancelled) return;
				setClients(clientRows);
				setProjects(projectRows);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const offered = value.clientId ? projects.filter((project) => project.clientId === value.clientId) : projects;

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<Select
				label="Client"
				value={value.clientId}
				disabled={disabled || lockClient}
				placeholder="No client"
				options={clients.map((client) => ({ value: client.id, label: client.name }))}
				onChange={(clientId) => {
					// A project of another client cannot stay chosen under this one.
					const project = projects.find((row) => row.id === value.projectId);
					const keep = project && (!clientId || project.clientId === clientId);
					onChange({ clientId, projectId: keep ? value.projectId : "" });
				}}
			/>
			<Select
				label="Project"
				value={value.projectId}
				disabled={disabled}
				placeholder="No project"
				options={offered.map((project) => ({
					value: project.id,
					label: value.clientId || !project.clientName ? project.name : `${project.name} (${project.clientName})`,
				}))}
				onChange={(projectId) => {
					const project = projects.find((row) => row.id === projectId);
					onChange({ clientId: project?.clientId ?? value.clientId, projectId });
				}}
				help={value.clientId ? undefined : "A project with a client brings its client along."}
			/>
		</div>
	);
}
