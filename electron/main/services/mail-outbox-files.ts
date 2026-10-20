/**
 * Files attached to an outgoing message from this machine, rather than from
 * Documents: chosen in the composer's picker or dropped on it.
 *
 * Any kind of file can be attached, the way any mail client allows. Such a
 * file is sent and forgotten. A PDF becomes a document only when the person
 * ticks "Add to documents" for it, and then only once the message has actually
 * gone, so a draft that is thrown away leaves nothing behind in Documents.
 * Documents keeps the PDF paperwork and nothing else, so another kind is
 * never kept.
 *
 * Until it is sent the draft holds a copy, under the outbox folder at a path
 * built from ids, never from the name the file arrived with. The original can
 * be moved or deleted and the draft still has its file. The copy is removed
 * once the message is sent or the draft is gone; the row stays, so the outbox
 * can still say what went with it.
 *
 * No agent tool adds a file: an agent would have to name a path on this
 * machine, which no tool may take (.claude/rules/mcp.md section 7). An agent
 * attaches documents instead, by id.
 *
 * No Electron import, so every rule here is covered by a test. The picker is in
 * mail-outbox-picker.ts.
 */
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isPdfName, mimeTypeOf } from "../../shared/mime";
import type { MailOutboxMessage } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import { mailOutbox, mailOutboxFiles } from "../db/schema";
import { keepSentFile } from "./document-import";
import * as outbox from "./mail-outbox";
import type { OutgoingAttachment } from "./mail-transport";

/**
 * Largest file that can be attached from this machine. Most mail servers
 * refuse a message much past 25 MB, and saying so here is kinder than a
 * refusal from the server after the upload.
 */
export const MAX_OUTBOX_FILE_BYTES = 25 * 1024 * 1024;

type Row = typeof mailOutboxFiles.$inferSelect;

let directory = "";

/** Injected once at startup, like every other folder, so this stays testable in plain Node. */
export function configureOutboxFiles(dir: string): void {
	directory = dir;
}

function storageDir(): string {
	if (!directory) throw new Error("configureOutboxFiles() was not called before a file was attached.");
	if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
	return directory;
}

/** Both parts are UUIDs this module made, so the path cannot leave the folder. */
function absolute(relativePath: string): string {
	return join(storageDir(), relativePath);
}

/** The name a recipient sees: no folders, no control characters, never empty. */
function cleanName(fileName: string): string {
	// Backslashes become slashes first, so a Windows path loses its folders too.
	const base = basename(String(fileName ?? "").replace(/\\/g, "/"));
	const printable = [...base].filter((character) => {
		const code = character.charCodeAt(0);
		return code >= 32 && code !== 127;
	});
	return printable.join("").trim() || "attachment";
}

function requireFile(id: string, db: Db): Row {
	const row = db
		.select()
		.from(mailOutboxFiles)
		.where(and(eq(mailOutboxFiles.id, id), isNull(mailOutboxFiles.deletedAt)))
		.get();
	if (!row) throw new Error("That attachment is no longer on the message.");
	return row;
}

async function messageOf(outboxId: string, db: Db): Promise<MailOutboxMessage> {
	const message = await outbox.get(outboxId, db);
	if (!message) throw new Error("That message does not exist.");
	return message;
}

/**
 * Attaches a file the window read from a drop. The bytes, never a path: the
 * window has none to give (.claude/rules/security.md section 2).
 */
export async function add(
	outboxId: string,
	input: { fileName: string; data: Uint8Array; fileDate?: string },
	db: Db = getDb(),
): Promise<MailOutboxMessage> {
	const name = cleanName(input.fileName);
	const bytes = Buffer.from(input.data);
	if (bytes.length === 0) throw new Error(`"${name}" is empty. Choose the file again.`);
	if (bytes.length > MAX_OUTBOX_FILE_BYTES) {
		throw new Error(`"${name}" is larger than 25 MB, which most mail servers refuse. Share it another way.`);
	}
	// Checked before anything is written, and touched after, so a message that
	// is no longer a draft gains no file and an agent's pending request to send
	// it is no longer the message that was approved.
	outbox.requireEditable(outboxId, db);

	const id = uuidv7();
	const relativePath = join(outboxId, id);
	mkdirSync(join(storageDir(), outboxId), { recursive: true });
	writeFileSync(absolute(relativePath), bytes);

	const date = input.fileDate && !Number.isNaN(new Date(input.fileDate).getTime()) ? input.fileDate : now();
	db.insert(mailOutboxFiles)
		.values({
			id,
			outboxId,
			fileName: name,
			mimeType: mimeTypeOf(name),
			byteSize: bytes.length,
			fileDate: new Date(date).toISOString(),
			relativePath,
		})
		.run();
	outbox.touchDraft(outboxId, db);
	return messageOf(outboxId, db);
}

/**
 * Attaches a file the main process's own picker returned. Never reached from
 * the window with a path of its choosing: the picker calls it and nothing else.
 */
export async function addFromPath(outboxId: string, path: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const name = basename(path);
	const size = statSync(path).size;
	if (size > MAX_OUTBOX_FILE_BYTES) {
		throw new Error(`"${name}" is larger than 25 MB, which most mail servers refuse. Share it another way.`);
	}
	return add(
		outboxId,
		{ fileName: name, data: new Uint8Array(readFileSync(path)), fileDate: statSync(path).mtime.toISOString() },
		db,
	);
}

function removeCopy(row: Pick<Row, "relativePath">): void {
	if (!row.relativePath) return;
	rmSync(absolute(row.relativePath), { force: true });
}

/** Takes a file off a message that has not gone. The copy goes with it. */
export async function remove(id: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireFile(id, db);
	outbox.requireEditable(row.outboxId, db);
	const stamp = now();
	db.update(mailOutboxFiles)
		.set({ deletedAt: stamp, updatedAt: stamp, relativePath: null })
		.where(eq(mailOutboxFiles.id, id))
		.run();
	removeCopy(row);
	outbox.touchDraft(row.outboxId, db);
	return messageOf(row.outboxId, db);
}

/**
 * Whether the file becomes a document once the message is sent. Changes
 * nothing about what is sent, so an agent's request to send the draft stays
 * the message that was asked about.
 */
export async function setKeep(id: string, keep: boolean, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireFile(id, db);
	outbox.requireEditable(row.outboxId, db);
	if (keep && !isPdfName(row.fileName)) {
		throw new Error(`"${row.fileName}" is not a PDF, and Documents keeps PDFs. It is sent and not kept.`);
	}
	db.update(mailOutboxFiles)
		.set({ keepAsDocument: keep, updatedAt: now() })
		.where(eq(mailOutboxFiles.id, id))
		.run();
	return messageOf(row.outboxId, db);
}

/** Live files on one message. */
function liveRows(outboxId: string, db: Db): Row[] {
	return db
		.select()
		.from(mailOutboxFiles)
		.where(and(eq(mailOutboxFiles.outboxId, outboxId), isNull(mailOutboxFiles.deletedAt)))
		.orderBy(asc(mailOutboxFiles.createdAt), asc(mailOutboxFiles.id))
		.all();
}

/** What the sender attaches. Refuses rather than sending the message without a file it was written with. */
export function toSend(outboxId: string, db: Db = getDb()): OutgoingAttachment[] {
	return liveRows(outboxId, db).map((row) => {
		const path = row.relativePath ? absolute(row.relativePath) : null;
		if (!path || !existsSync(path)) {
			throw new Error(`"${row.fileName}" is no longer on this machine. Attach it again, then send.`);
		}
		return { filename: row.fileName, path, contentType: row.mimeType };
	});
}

/**
 * After a message has gone: the files marked to keep become documents under
 * the message's client and project, and every copy is removed. A file that
 * cannot be kept says why on its row and does not undo the send.
 */
export async function afterSent(
	message: { id: string; clientId: string | null; projectId: string | null },
	db: Db = getDb(),
): Promise<void> {
	for (const row of liveRows(message.id, db)) {
		if (row.keepAsDocument && row.relativePath && !row.documentId) {
			try {
				const document = await keepSentFile(
					{
						data: new Uint8Array(readFileSync(absolute(row.relativePath))),
						fileName: row.fileName,
						fileDate: row.fileDate,
						clientId: message.clientId,
						projectId: message.projectId,
					},
					db,
				);
				db.update(mailOutboxFiles)
					.set({ documentId: document.id, keepError: null, updatedAt: now() })
					.where(eq(mailOutboxFiles.id, row.id))
					.run();
			} catch (cause) {
				db.update(mailOutboxFiles)
					.set({
						keepError: (cause instanceof Error ? cause.message : "It could not be added to documents.").slice(0, 500),
						updatedAt: now(),
					})
					.where(eq(mailOutboxFiles.id, row.id))
					.run();
			}
		}
		removeCopy(row);
		db.update(mailOutboxFiles)
			.set({ relativePath: null, updatedAt: now() })
			.where(eq(mailOutboxFiles.id, row.id))
			.run();
	}
}

/**
 * Removes copies nothing will send any more: files taken off, and files of a
 * message that was sent, cancelled or deleted. Run at startup, so a crash
 * between sending and tidying up leaves nothing behind for long.
 */
export function prune(db: Db = getDb()): number {
	const rows = db
		.select({ id: mailOutboxFiles.id, relativePath: mailOutboxFiles.relativePath })
		.from(mailOutboxFiles)
		.innerJoin(mailOutbox, eq(mailOutboxFiles.outboxId, mailOutbox.id))
		.where(
			and(
				isNotNull(mailOutboxFiles.relativePath),
				or(
					isNotNull(mailOutboxFiles.deletedAt),
					isNotNull(mailOutbox.deletedAt),
					inArray(mailOutbox.state, ["sent", "cancelled"]),
				),
			),
		)
		.all();
	for (const row of rows) {
		removeCopy(row);
		db.update(mailOutboxFiles)
			.set({ relativePath: null, updatedAt: now() })
			.where(eq(mailOutboxFiles.id, row.id))
			.run();
	}
	return rows.length;
}
