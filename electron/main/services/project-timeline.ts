/**
 * A project's history, in one stream, newest first.
 *
 * Like the client timeline, nothing here is a second record of what happened.
 * Each line is read back out of the table that already holds it. The one
 * exception is a status change, which a project's own row cannot say, so the
 * projects service writes one row per change (project_status_changes).
 *
 * A line is only as exact as its source: a mail thread has no "linked on"
 * instant, so it sits at the time of its last message, and a document has no
 * "sent on" instant either, so it sits at its last edit.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type {
	ProjectTimelineEntry,
	ProjectTimelineKind,
	ProjectTimelineQuery,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import {
	clients,
	documentSignatures,
	documents,
	mailThreads,
	projectLinks,
	projectStatusChanges,
	referenceItems,
	timeEntries,
} from "../db/schema";
import { requireProject } from "./projects";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

const ALL_KINDS: ProjectTimelineKind[] = [
	"status",
	"mail",
	"quote",
	"time",
	"contract",
	"created",
	"folder",
];

/** The statuses that mean a document has gone out and is waiting on the other side. */
const SENT_KEYS = ["sent", "awaiting_signature"];

/** 90 is "1 h 30 min", 240 is "4 h", 45 is "45 min". Shared in spirit with the renderer's long form. */
export function describeMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest} min`;
	return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export async function timeline(
	query: ProjectTimelineQuery,
	db: Db = getDb(),
): Promise<ProjectTimelineEntry[]> {
	const project = requireProject(query.projectId, db);
	const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const wanted = new Set<ProjectTimelineKind>(query.kinds ?? ALL_KINDS);
	const entries: ProjectTimelineEntry[] = [];

	if (wanted.has("created")) {
		const client = project.clientId
			? db.select({ name: clients.name }).from(clients).where(eq(clients.id, project.clientId)).get()
			: undefined;
		entries.push({
			id: `created:${project.id}`,
			kind: "created",
			at: project.createdAt,
			title: "Project created",
			detail: client ? `Linked to ${client.name}` : null,
			entityId: null,
		});
	}

	if (wanted.has("status")) {
		const fromStatus = alias(referenceItems, "from_status");
		const toStatus = alias(referenceItems, "to_status");
		for (const row of db
			.select({
				id: projectStatusChanges.id,
				changedAt: projectStatusChanges.changedAt,
				fromLabel: fromStatus.label,
				toLabel: toStatus.label,
			})
			.from(projectStatusChanges)
			.leftJoin(fromStatus, eq(fromStatus.id, projectStatusChanges.fromStatusId))
			.leftJoin(toStatus, eq(toStatus.id, projectStatusChanges.toStatusId))
			.where(and(eq(projectStatusChanges.projectId, project.id), isNull(projectStatusChanges.deletedAt)))
			.orderBy(desc(projectStatusChanges.changedAt), desc(projectStatusChanges.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `status:${row.id}`,
				kind: "status",
				at: row.changedAt,
				title: row.toLabel ? `Status set to ${row.toLabel}` : "Status cleared",
				detail: row.fromLabel ? `Was ${row.fromLabel}` : null,
				entityId: row.id,
			});
		}
	}

	if (wanted.has("mail")) {
		for (const row of db
			.select({ id: mailThreads.id, subject: mailThreads.subject, lastMessageAt: mailThreads.lastMessageAt })
			.from(mailThreads)
			.where(and(eq(mailThreads.projectId, project.id), isNull(mailThreads.deletedAt)))
			.orderBy(desc(mailThreads.lastMessageAt), desc(mailThreads.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `mail:${row.id}`,
				kind: "mail",
				at: row.lastMessageAt,
				title: `Mail linked: ${row.subject}`,
				detail: null,
				entityId: row.id,
			});
		}
	}

	if (wanted.has("quote")) {
		for (const row of db
			.select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt })
			.from(documents)
			.innerJoin(referenceItems, eq(referenceItems.id, documents.statusId))
			.where(
				and(
					eq(documents.projectId, project.id),
					isNull(documents.deletedAt),
					inArray(referenceItems.key, SENT_KEYS),
				),
			)
			.orderBy(desc(documents.updatedAt), desc(documents.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `quote:${row.id}`,
				kind: "quote",
				at: row.updatedAt,
				title: `${row.title} sent for signature`,
				detail: "Waiting for the signature",
				entityId: row.id,
			});
		}
	}

	if (wanted.has("contract")) {
		for (const row of db
			.select({
				id: documentSignatures.id,
				documentId: documents.id,
				title: documents.title,
				signedAt: documentSignatures.signedAt,
				signer: documentSignatures.signerName,
			})
			.from(documentSignatures)
			.innerJoin(documents, eq(documents.id, documentSignatures.documentId))
			.where(
				and(
					eq(documents.projectId, project.id),
					isNull(documents.deletedAt),
					isNull(documentSignatures.deletedAt),
				),
			)
			.orderBy(desc(documentSignatures.signedAt), desc(documentSignatures.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `contract:${row.id}`,
				kind: "contract",
				at: row.signedAt,
				title: `${row.title} signed`,
				detail: `Signed by ${row.signer}`,
				entityId: row.documentId,
			});
		}
	}

	if (wanted.has("time")) {
		for (const row of db
			.select()
			.from(timeEntries)
			.where(and(eq(timeEntries.projectId, project.id), isNull(timeEntries.deletedAt)))
			.orderBy(desc(timeEntries.startedAt), desc(timeEntries.id))
			.limit(limit)
			.all()) {
			if (row.durationMinutes === null) continue;
			entries.push({
				id: `time:${row.id}`,
				kind: "time",
				at: row.startedAt,
				title: `Time entry: ${describeMinutes(row.durationMinutes)}${row.note ? ` ${row.note}` : ""}`,
				detail: null,
				entityId: row.id,
			});
		}
	}

	if (wanted.has("folder")) {
		for (const row of db
			.select({ id: projectLinks.id, createdAt: projectLinks.createdAt, label: projectLinks.label })
			.from(projectLinks)
			.where(
				and(
					eq(projectLinks.projectId, project.id),
					eq(projectLinks.kind, "folder"),
					isNull(projectLinks.deletedAt),
				),
			)
			.orderBy(desc(projectLinks.createdAt), desc(projectLinks.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `folder:${row.id}`,
				kind: "folder",
				at: row.createdAt,
				title: "Folder connected",
				detail: row.label,
				entityId: row.id,
			});
		}
	}

	return (
		entries
			// Newest first, the id breaking a tie so a page boundary stays put.
			.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1))
			.slice(0, limit)
	);
}
