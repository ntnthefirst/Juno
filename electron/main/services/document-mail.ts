/**
 * A conversation's attachments as documents, in one step.
 *
 * Docs a company sends belong to the job they are about. A conversation filed
 * under a project saves its attachments there, one filed under a client only
 * under the client, and one filed under neither asks where, starting from the
 * project the mail suggestions would offer (suggestions.ts) and filing the
 * conversation there at the same time when the person says so.
 *
 * Each file gets the same check a drop gets (document-import.ts): the same
 * bytes as a version already kept are skipped and said so, a file that looks
 * like a document already kept (its words, or its name in that place) waits
 * for the person to compare the two, and anything else is saved straight
 * away. Nothing is filed as a version on a guess (decision 39).
 *
 * Whether an attachment is already a document is decided here, by its bytes,
 * so the reader, the right-click menu and an agent all say the same.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { readFileSync } from "node:fs";
import type {
	AttachmentDocument,
	DocumentPlace,
	SaveThreadAttachmentsInput,
	SaveThreadAttachmentsResult,
	SavedAttachment,
	ThreadAttachment,
	ThreadAttachments,
	ThreadDocumentPlace,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { documentVersions, documents, mailAttachments, mailMessages } from "../db/schema";
import { analyse, createDocument, resolveSource } from "./document-import";
import { resolvePlace } from "./document-place";
import { hashBytes } from "./document-versions";
import * as clients from "./clients";
import * as threads from "./mail-threads";
import * as projects from "./projects";
import { projectForThread } from "./suggestions";

/** How many attachments one save takes. A conversation with more is saved in parts. */
export const MAX_ATTACHMENTS_PER_SAVE = 50;

/**
 * A stored attachment is never written to again, so its hash is worked out
 * once per run. Keyed by id and size, so a row that somehow points at another
 * file is read again.
 */
const hashes = new Map<string, string>();

function hashOf(attachment: { id: string; size: number }, db: Db): string | null {
	const key = `${attachment.id}:${attachment.size}`;
	const known = hashes.get(key);
	if (known) return known;
	try {
		const hash = hashBytes(readFileSync(threads.attachmentPath(attachment.id, db).path));
		hashes.set(key, hash);
		return hash;
	} catch {
		// A file missing from the mail folder is not a document, and the reader says so when it is opened.
		return null;
	}
}

type AttachmentRow = { id: string; messageId: string; filename: string; size: number };

/** The conversation's own attachments, oldest message first, without the pictures in its bodies. */
function attachmentRows(threadId: string, db: Db): AttachmentRow[] {
	return db
		.select({
			id: mailAttachments.id,
			messageId: mailAttachments.messageId,
			filename: mailAttachments.filename,
			size: mailAttachments.size,
		})
		.from(mailAttachments)
		.innerJoin(mailMessages, eq(mailAttachments.messageId, mailMessages.id))
		.where(
			and(
				eq(mailMessages.threadId, threadId),
				eq(mailAttachments.isInline, false),
				isNull(mailAttachments.deletedAt),
				isNull(mailMessages.deletedAt),
			),
		)
		.orderBy(mailMessages.internalDate, mailAttachments.id)
		.all();
}

/**
 * The document each attachment already is: a live version recorded from that
 * very attachment, or one with the same bytes. Two documents with the same
 * bytes resolve to the older, which is the one that was kept first.
 */
export function documentsFor(rows: AttachmentRow[], db: Db = getDb()): Map<string, AttachmentDocument> {
	const out = new Map<string, AttachmentDocument>();
	if (rows.length === 0) return out;
	const byHash = new Map<string, string[]>();
	for (const row of rows) {
		const hash = hashOf(row, db);
		if (!hash) continue;
		byHash.set(hash, [...(byHash.get(hash) ?? []), row.id]);
	}
	const ids = rows.map((row) => row.id);
	const found = db
		.select({
			documentId: documents.id,
			title: documents.title,
			clientId: documents.clientId,
			projectId: documents.projectId,
			fileHash: documentVersions.fileHash,
			mailAttachmentId: documentVersions.mailAttachmentId,
			createdAt: documents.createdAt,
		})
		.from(documentVersions)
		.innerJoin(documents, eq(documentVersions.documentId, documents.id))
		.where(
			and(
				isNull(documentVersions.deletedAt),
				isNull(documents.deletedAt),
				// One kept straight from this attachment is found by its id too, in case its file could not be read.
				byHash.size > 0
					? or(inArray(documentVersions.fileHash, [...byHash.keys()]), inArray(documentVersions.mailAttachmentId, ids))
					: inArray(documentVersions.mailAttachmentId, ids),
			),
		)
		.all();
	const candidates = found.sort(
		(a, b) => a.createdAt.localeCompare(b.createdAt) || a.documentId.localeCompare(b.documentId),
	);
	for (const candidate of candidates) {
		const owners = [
			...(candidate.mailAttachmentId ? [candidate.mailAttachmentId] : []),
			...(candidate.fileHash ? (byHash.get(candidate.fileHash) ?? []) : []),
		].filter((id) => ids.includes(id));
		for (const attachmentId of owners) {
			if (out.has(attachmentId)) continue;
			out.set(attachmentId, {
				documentId: candidate.documentId,
				title: candidate.title,
				clientId: candidate.clientId,
				projectId: candidate.projectId,
			});
		}
	}
	return out;
}

async function placeOf(threadId: string, db: Db): Promise<ThreadDocumentPlace | null> {
	const thread = await threads.getThread(threadId, db);
	if (!thread) throw new Error("That conversation no longer exists.");
	const { summary } = thread;
	if (summary.projectId) {
		const project = await projects.get(summary.projectId, db);
		const client = project?.clientId ? await clients.get(project.clientId, db) : null;
		return {
			clientId: project?.clientId ?? null,
			clientName: client?.name ?? null,
			projectId: summary.projectId,
			projectName: summary.projectName,
			name: summary.projectName ?? project?.name ?? "the project",
			linked: true,
		};
	}
	if (summary.clientId) {
		return {
			clientId: summary.clientId,
			clientName: summary.clientName,
			projectId: null,
			projectName: null,
			name: summary.clientName ?? "the client",
			linked: true,
		};
	}
	const suggested = await projectForThread(threadId, db);
	const project = suggested ? await projects.get(suggested, db) : null;
	if (!project) return null;
	const client = project.clientId ? await clients.get(project.clientId, db) : null;
	return {
		clientId: project.clientId,
		clientName: client?.name ?? null,
		projectId: project.id,
		projectName: project.name,
		name: project.name,
		linked: false,
	};
}

/**
 * Every attachment of a conversation, each with the document it already is,
 * and where a one-step save would put the rest. Writes nothing.
 */
export async function forThread(threadId: string, db: Db = getDb()): Promise<ThreadAttachments> {
	const place = await placeOf(threadId, db);
	const rows = attachmentRows(threadId, db);
	const kept = documentsFor(rows, db);
	const attachments: ThreadAttachment[] = rows.map((row) => ({
		attachmentId: row.id,
		messageId: row.messageId,
		fileName: row.filename,
		document: kept.get(row.id) ?? null,
	}));
	return { threadId, place, attachments };
}

/** The names of the attachments a save with none named would take: every one that is not a document yet. */
export function unsavedAttachmentNames(threadId: string, db: Db = getDb()): string[] {
	const rows = attachmentRows(threadId, db);
	const kept = documentsFor(rows, db);
	return rows.filter((row) => !kept.has(row.id)).map((row) => row.filename);
}

/** The conversation an attachment arrived in, for a caller that names the attachment alone. */
export function threadOfAttachment(attachmentId: string, db: Db = getDb()): string | null {
	const row = db
		.select({ threadId: mailMessages.threadId })
		.from(mailAttachments)
		.innerJoin(mailMessages, eq(mailAttachments.messageId, mailMessages.id))
		.where(and(eq(mailAttachments.id, attachmentId), isNull(mailAttachments.deletedAt), isNull(mailMessages.deletedAt)))
		.get();
	return row?.threadId ?? null;
}

/**
 * Saves a conversation's attachments as documents, each through the same
 * check a drop gets. With no place given they go to the conversation's
 * project, or its client; with `linkThread` the conversation is filed under
 * the place first, in the same call, so a link that cannot be made saves
 * nothing.
 */
export async function saveFromThread(
	input: SaveThreadAttachmentsInput,
	db: Db = getDb(),
): Promise<SaveThreadAttachmentsResult> {
	const thread = await threads.getThread(input.threadId, db);
	if (!thread) throw new Error("That conversation no longer exists.");
	const rows = attachmentRows(input.threadId, db);
	if (rows.length === 0) throw new Error("This conversation has no attachments to save.");

	let chosen: AttachmentRow[];
	if (input.attachmentIds) {
		const wanted = [...new Set(input.attachmentIds)];
		const missing = wanted.filter((id) => !rows.some((row) => row.id === id));
		if (missing.length > 0) {
			throw new Error("One of those attachments is not in this conversation. Read the conversation again and pick from its attachments.");
		}
		chosen = rows.filter((row) => wanted.includes(row.id));
	} else {
		// Every one that is not a document yet: saving all again would only skip the rest.
		const kept = documentsFor(rows, db);
		chosen = rows.filter((row) => !kept.has(row.id));
	}
	if (chosen.length > MAX_ATTACHMENTS_PER_SAVE) {
		throw new Error(`That is ${chosen.length} attachments. Save at most ${MAX_ATTACHMENTS_PER_SAVE} at a time.`);
	}

	// A place named at all, even none (both null), is the place; none named is the conversation's own.
	const asked = input.clientId !== undefined || input.projectId !== undefined;
	const { summary } = thread;
	if (!asked && !summary.projectId && !summary.clientId) {
		throw new Error("This conversation is not filed under a client or a project. Choose where the files go.");
	}
	// The project alone when the conversation has one, because a project brings its own client
	// and the conversation's client may be the one writing about it (mail-threads.linkProject).
	const placeInput: DocumentPlace = asked
		? { clientId: input.clientId ?? null, projectId: input.projectId ?? null }
		: summary.projectId
			? { clientId: null, projectId: summary.projectId }
			: { clientId: summary.clientId, projectId: null };
	const resolved = resolvePlace(placeInput, db);
	const place: DocumentPlace = { clientId: resolved.clientId, projectId: resolved.projectId };

	let threadSummary = summary;
	if (input.linkThread) {
		if (place.projectId && summary.projectId !== place.projectId) {
			threadSummary = await threads.linkProject(input.threadId, place.projectId, db);
		} else if (!place.projectId && place.clientId && !summary.clientId) {
			threadSummary = await threads.linkClient(input.threadId, place.clientId, db);
		}
	}

	const outcomes: SavedAttachment[] = [];
	for (const row of chosen) {
		try {
			const file = resolveSource({ kind: "attachment", attachmentId: row.id }, db);
			const analysis = await analyse(file, place, db);
			const identical = analysis.matches.find((match) => match.identical);
			if (identical) {
				outcomes.push({
					attachmentId: row.id,
					fileName: row.filename,
					status: "skipped",
					document: {
						documentId: identical.documentId,
						title: identical.title,
						clientId: identical.clientId,
						projectId: identical.projectId,
					},
				});
				continue;
			}
			const match = analysis.matches[0];
			if (match) {
				outcomes.push({ attachmentId: row.id, fileName: row.filename, status: "review", match });
				continue;
			}
			const { record } = await createDocument(file, { ...place, title: analysis.availableTitle }, db);
			outcomes.push({ attachmentId: row.id, fileName: row.filename, status: "saved", document: record });
		} catch (cause: unknown) {
			outcomes.push({
				attachmentId: row.id,
				fileName: row.filename,
				status: "failed",
				message: cause instanceof Error ? cause.message : `${row.filename} could not be saved.`,
			});
		}
	}
	return { thread: threadSummary, place, outcomes };
}
