/**
 * What has happened to a document, in one stream.
 *
 * Like the client timeline, nothing here is a second record. Each version is a
 * row that already exists, and an email is read back out of the outbox, so the
 * timeline cannot disagree with the version list or with the mail screen.
 *
 * A document has no history of its status. That is not invented here: a status
 * change would need its own table, the way a client's has, and nobody has asked
 * for it yet.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type {
	DocumentTimelineEntry,
	DocumentVersionSource,
	MailAddress,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { documents, mailOutbox, mailOutboxAttachments } from "../db/schema";
import * as versions from "./document-versions";

const SOURCE_WORDS: Record<DocumentVersionSource, string> = {
	generate: "Made in Juno",
	picker: "Chosen from a folder",
	drop: "Dropped in",
	mail: "From a mail",
	sign: "Signed in Juno",
	agent: "Added by the agent",
};

/** `to_json` is written by the outbox, but a bad row must not take the timeline down with it. */
function recipients(json: string): string {
	let list: MailAddress[] = [];
	try {
		const parsed: unknown = JSON.parse(json);
		if (Array.isArray(parsed)) list = parsed as MailAddress[];
	} catch {
		return "";
	}
	const names = list.map((entry) => entry.name?.trim() || entry.address).filter(Boolean);
	if (names.length <= 2) return names.join(" and ");
	return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export async function timeline(documentId: string, db: Db = getDb()): Promise<DocumentTimelineEntry[]> {
	const record = db
		.select({ id: documents.id, createdAt: documents.createdAt })
		.from(documents)
		.where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
		.get();
	if (!record) throw new Error("That document no longer exists.");

	const entries: DocumentTimelineEntry[] = [];

	const files = versions.list(documentId, db);
	for (const version of files) {
		const source = SOURCE_WORDS[version.source];
		if (version.kind === "generated") {
			entries.push({
				id: `version:${version.id}`,
				kind: "generated",
				at: version.fileDate,
				title: "Generated from a template",
				detail: null,
				versionId: version.id,
			});
		} else if (version.kind === "imported") {
			entries.push({
				id: `version:${version.id}`,
				kind: "imported",
				at: version.fileDate,
				title: "Imported as a PDF",
				detail: [source, version.fileName].filter(Boolean).join(", "),
				versionId: version.id,
			});
		} else {
			const by = version.signerName ? ` by ${version.signerName}` : "";
			entries.push({
				id: `version:${version.id}`,
				kind: version.kind,
				at: version.fileDate,
				title: version.kind === "signed" ? `Signed digitally${by}` : `Stamped${by}`,
				detail: version.digital ? `Certificate of ${version.digital.subject}` : null,
				versionId: version.id,
			});
		}
	}

	// A document whose PDF has not been written yet still began somewhere.
	if (files.length === 0) {
		entries.push({
			id: `document:${record.id}`,
			kind: "created",
			at: record.createdAt,
			title: "Created",
			detail: null,
			versionId: null,
		});
	}

	// The states that mean the message left or is about to. A draft is not an event
	// yet and a cancelled message never happened.
	const mails = db
		.select({
			id: mailOutbox.id,
			state: mailOutbox.state,
			toJson: mailOutbox.toJson,
			sentAt: mailOutbox.sentAt,
			queuedAt: mailOutbox.queuedAt,
			subject: mailOutbox.subject,
		})
		.from(mailOutboxAttachments)
		.innerJoin(mailOutbox, eq(mailOutboxAttachments.outboxId, mailOutbox.id))
		.where(
			and(
				eq(mailOutboxAttachments.documentId, documentId),
				isNull(mailOutboxAttachments.deletedAt),
				isNull(mailOutbox.deletedAt),
			),
		)
		.orderBy(asc(mailOutbox.createdAt))
		.all();
	for (const mail of mails) {
		const to = recipients(mail.toJson);
		const where = to ? ` to ${to}` : "";
		if (mail.state === "sent" && mail.sentAt) {
			entries.push({
				id: `mail:${mail.id}`,
				kind: "emailed",
				at: mail.sentAt,
				title: `Sent by email${where}`,
				detail: mail.subject || null,
				versionId: null,
			});
		} else if ((mail.state === "queued" || mail.state === "sending") && mail.queuedAt) {
			entries.push({
				id: `mail:${mail.id}`,
				kind: "emailed",
				at: mail.queuedAt,
				title: `Waiting to be emailed${where}`,
				detail: mail.subject || null,
				versionId: null,
			});
		}
	}

	// Newest first, with the id as the tiebreaker so two entries in one instant keep their order.
	return entries.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}
