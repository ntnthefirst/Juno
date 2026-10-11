/**
 * What a document belongs to: a client, a project, both, or nothing.
 *
 * One rule, used by generating, importing and relinking alike, so the three
 * cannot disagree: a project that has a client brings that client along, so
 * the client's page still lists the document, and naming a client the project
 * does not belong to is refused rather than quietly corrected. A project of
 * the owner's own has no client, and neither does its document.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { clients, projects } from "../db/schema";

export interface DocumentOwner {
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
}

export function resolveOwner(
	input: { clientId?: string | null; projectId?: string | null },
	db: Db = getDb(),
): DocumentOwner {
	const project = input.projectId
		? db
				.select()
				.from(projects)
				.where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
				.get()
		: null;
	if (input.projectId && !project) throw new Error("That project no longer exists. Pick another one or none.");

	const clientId = input.clientId ?? project?.clientId ?? null;
	if (project && input.clientId && project.clientId !== input.clientId) {
		throw new Error(
			project.clientId
				? "That project belongs to a different client. Pick its client, or leave the client empty."
				: "That project is your own work and has no client. Leave the client empty to keep it under the project.",
		);
	}

	const client = clientId
		? db
				.select()
				.from(clients)
				.where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
				.get()
		: null;
	if (clientId && !client) throw new Error("That client no longer exists. Pick another one or none.");

	return {
		clientId: client?.id ?? null,
		clientName: client?.name ?? null,
		projectId: project?.id ?? null,
		projectName: project?.name ?? null,
	};
}
