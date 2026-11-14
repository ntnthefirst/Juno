import type { ClientSummary, DocumentRecord, ProjectSummary } from "@shared/types";

/**
 * One place a document can be kept: a client, or a project, under its client
 * when it has one. `key` is `client:<id>` or `project:<id>`.
 */
export type PlaceOption = {
	key: string;
	kind: "client" | "project";
	name: string;
	/** 0 for a client and a project of your own, 1 for a client's project. */
	depth: number;
	clientId: string | null;
	projectId: string | null;
	/** The client a project is under, for a filtered list where the nesting is gone. */
	clientName: string | null;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Every client by name with its projects under it, then the projects of your
 * own, and those whose client is gone, so none is left out.
 */
export function placeOptions(clients: readonly ClientSummary[], projects: readonly ProjectSummary[]): PlaceOption[] {
	const byName = <T extends { name: string; id: string }>(a: T, b: T) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
	const sortedProjects = [...projects].sort(byName);
	const clientIds = new Set(clients.map((client) => client.id));
	const options: PlaceOption[] = [];
	for (const client of [...clients].sort(byName)) {
		options.push({ key: `client:${client.id}`, kind: "client", name: client.name, depth: 0, clientId: client.id, projectId: null, clientName: null });
		for (const project of sortedProjects.filter((row) => row.clientId === client.id)) {
			options.push({
				key: `project:${project.id}`,
				kind: "project",
				name: project.name,
				depth: 1,
				clientId: client.id,
				projectId: project.id,
				clientName: client.name,
			});
		}
	}
	for (const project of sortedProjects.filter((row) => !row.clientId || !clientIds.has(row.clientId))) {
		options.push({
			key: `project:${project.id}`,
			kind: "project",
			name: project.name,
			depth: 0,
			clientId: project.clientId && clientIds.has(project.clientId) ? project.clientId : null,
			projectId: project.id,
			clientName: null,
		});
	}
	return options;
}

/** The option a document is kept at now: its project when it has one, otherwise its client. */
export function placeKeyOf(record: Pick<DocumentRecord, "clientId" | "projectId">): string | null {
	if (record.projectId) return `project:${record.projectId}`;
	if (record.clientId) return `client:${record.clientId}`;
	return null;
}
