/**
 * Bringing a file in: as a document of its own, or as a new version of one
 * that exists, and working out which of the two it probably is.
 *
 * Any kind of file (decision 75). A PDF, a Word file, a spreadsheet and plain
 * text are recognised by their words as well as their bytes; anything else by
 * its bytes or its name only (file-text.ts).
 *
 * A file arrives three ways: bytes the window read from a drop or its picker, a
 * mail attachment named by id, or a path an agent gives. The first two are
 * what the window may send, and neither is a path, so nothing the renderer
 * says is ever joined onto the filesystem (.claude/rules/security.md section 2).
 * The path form has its own functions, used by the agent's tools only.
 *
 * No Electron import, so every rule here is covered by a test.
 */
import { and, eq, isNull } from "drizzle-orm";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extensionOf } from "../../shared/mime";
import type {
	AddVersionInput,
	AnalyseImportInput,
	DocumentVersion,
	DocumentVersionSource,
	ImportAnalysis,
	ImportDocumentInput,
	ImportFileInput,
	ImportFromMailInput,
	ImportFromMailResult,
	ImportMatch,
	ImportSource,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { documents, mailAttachments, mailMessages, mailThreads } from "../db/schema";
import { todayIsoDate } from "./document-context";
import { resolveOwner } from "./document-owner";
import { assertTitleFree, availableTitle, documentTitled, resolvePlace } from "./document-place";
import * as versions from "./document-versions";
import { documentStorageDir, fileNameFor, get, type DocumentRecord } from "./documents";
import { familyOf, isPdfBytes, mediaTypeFor } from "./file-kind";
import { matchText } from "./file-text";
import { attachmentPath } from "./mail-threads";
import { compareText } from "./pdf-text";

/**
 * Largest file that can be brought in. Every byte crosses from the window as
 * one message, so this is a limit on that as much as on the folder.
 */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** How many documents an analysis offers. More than this is a list nobody reads. */
const MAX_MATCHES = 5;

export interface Resolved {
	bytes: Buffer;
	fileName: string;
	fileDate: string;
	mediaType: string;
	source: DocumentVersionSource;
	mailAttachmentId: string | null;
	/** The client the mail thread is linked to, when it came from mail. */
	threadClientId: string | null;
}

export function validDate(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return fallback;
	// A clock set wrong on the machine that saved the file should not make it
	// the newest version for years.
	const nowIso = new Date().toISOString();
	const iso = date.toISOString();
	return iso > nowIso ? nowIso : iso;
}

/**
 * Refuses an empty file, one past the size limit, and one that calls itself a
 * PDF and is not, because everything downstream of a `.pdf` (the viewer,
 * signing) trusts that it is one.
 */
export function checkFile(bytes: Uint8Array, label: string): void {
	if (bytes.length === 0) throw new Error(`"${label}" is empty. Choose a file with something in it.`);
	if (bytes.length > MAX_IMPORT_BYTES) {
		throw new Error(`"${label}" is larger than 100 MB. Keep it in a project's files instead, which can link to it.`);
	}
	if (familyOf(label) === "pdf" && !isPdfBytes(bytes)) {
		throw new Error(`"${label}" is not a PDF, though its name says so. Check the file and add it again.`);
	}
}

/** The only place a window-supplied source is turned into bytes. */
export function resolveSource(source: ImportSource, db: Db): Resolved {
	if (source.kind === "bytes") {
		const bytes = Buffer.from(source.data);
		const fileName = basename(String(source.fileName ?? "")).trim() || "Document";
		checkFile(bytes, fileName);
		return {
			bytes,
			fileName,
			fileDate: validDate(source.fileDate, new Date().toISOString()),
			mediaType: mediaTypeFor(fileName),
			source: source.via === "picker" ? "picker" : "drop",
			mailAttachmentId: null,
			threadClientId: null,
		};
	}
	if (source.kind === "attachment") {
		const row = db
			.select({
				messageDate: mailMessages.sentAt,
				internalDate: mailMessages.internalDate,
				clientId: mailThreads.clientId,
			})
			.from(mailAttachments)
			.innerJoin(mailMessages, eq(mailAttachments.messageId, mailMessages.id))
			.innerJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
			.where(and(eq(mailAttachments.id, source.attachmentId), isNull(mailAttachments.deletedAt)))
			.get();
		if (!row) throw new Error("That attachment does not exist.");
		const { path, filename } = attachmentPath(source.attachmentId, db);
		const bytes = readFileSync(path);
		checkFile(bytes, filename);
		return {
			bytes,
			fileName: filename,
			fileDate: validDate(row.messageDate ?? row.internalDate, new Date().toISOString()),
			mediaType: mediaTypeFor(filename),
			source: "mail",
			mailAttachmentId: source.attachmentId,
			threadClientId: row.clientId,
		};
	}
	throw new Error("A file can only be brought in from a drop, the file picker or a mail attachment.");
}

/** For the agent's tools, which name a file on this machine. */
export function resolvePath(sourcePath: string): Resolved {
	const label = basename(sourcePath);
	if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
		throw new Error(`Could not find "${label}". Check the file still exists at that location.`);
	}
	if (statSync(sourcePath).size > MAX_IMPORT_BYTES) {
		throw new Error(`"${label}" is larger than 100 MB. Keep it in a project's files instead, which can link to it.`);
	}
	const bytes = readFileSync(sourcePath);
	checkFile(bytes, label);
	return {
		bytes,
		fileName: label,
		fileDate: validDate(statSync(sourcePath).mtime.toISOString(), new Date().toISOString()),
		mediaType: mediaTypeFor(label),
		source: "agent",
		mailAttachmentId: null,
		threadClientId: null,
	};
}

/** A title from a file name: the name without its extension. The tile says what kind it is. */
export function titleOf(fileName: string): string {
	const extension = extensionOf(fileName);
	const base = extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
	return base.trim() || "Document";
}

/**
 * Which existing documents the file looks like: the same bytes, the same
 * words with a signature or a stamp added, or the same name in the place it is
 * going to.
 */
async function analyse(
	file: Resolved,
	placeInput: { clientId?: string | null; projectId?: string | null; folderId?: string | null },
	db: Db,
): Promise<ImportAnalysis> {
	const hash = versions.hashBytes(file.bytes);
	const text = await matchText(file.bytes, file.fileName);

	const best = new Map<string, { score: number; identical: boolean }>();
	for (const row of versions.fingerprints(db)) {
		const identical = row.fileHash === hash;
		let score = identical ? 1 : 0;
		if (!identical && text && row.textContent) {
			const match = compareText(text, row.textContent);
			score = match.same ? match.score : 0;
		}
		if (score === 0) continue;
		const current = best.get(row.documentId);
		if (!current || identical || score > current.score) {
			best.set(row.documentId, { score, identical: identical || (current?.identical ?? false) });
		}
	}

	// The place it is going to: the one asked for, or the mail thread's client.
	const asked = placeInput.clientId || placeInput.projectId || placeInput.folderId;
	const place = resolvePlace(asked ? placeInput : { clientId: file.threadClientId }, db);

	const defaultTitle = titleOf(file.fileName);
	const named = documentTitled(place, defaultTitle, db);
	const ids = [...best.keys(), ...(named && !best.has(named.id) ? [named.id] : [])];

	const matches: ImportMatch[] = [];
	for (const id of ids) {
		const record = await get(id, db);
		if (!record) continue;
		const found = best.get(id);
		matches.push({
			documentId: id,
			title: record.title,
			clientId: record.clientId,
			clientName: record.clientName,
			projectId: record.projectId,
			folderId: record.folderId,
			score: found?.score ?? 0,
			identical: found?.identical ?? false,
			reason: found ? (found.identical ? "bytes" : "text") : "name",
			latestVersion: record.latestVersion,
		});
	}
	const wantedClient = place.clientId;
	matches.sort(
		(a, b) =>
			Number(b.identical) - Number(a.identical) ||
			Number(b.clientId === wantedClient) - Number(a.clientId === wantedClient) ||
			b.score - a.score,
	);

	return {
		fileName: file.fileName,
		defaultTitle,
		availableTitle: availableTitle(place, defaultTitle, db),
		suggestedClientId: wantedClient ?? matches[0]?.clientId ?? null,
		matches: matches.slice(0, MAX_MATCHES),
		fileDate: file.fileDate,
		mediaType: file.mediaType,
		byteSize: file.bytes.length,
	};
}

export async function analyseImport(input: AnalyseImportInput, db: Db = getDb()): Promise<ImportAnalysis> {
	return analyse(resolveSource(input.source, db), input, db);
}

export async function analysePath(
	input: { sourcePath: string; clientId?: string | null; projectId?: string | null; folderId?: string | null },
	db: Db = getDb(),
): Promise<ImportAnalysis> {
	return analyse(resolvePath(input.sourcePath), input, db);
}

/** Writes the bytes under a name the service builds, keeping the file's own extension. */
function store(title: string, suffix: string, file: Resolved): string {
	// The stored name comes from the title through fileNameFor, never from the
	// name the file arrived with, so "../" in either cannot leave the folder.
	const destination = join(documentStorageDir(), fileNameFor(title, suffix, extensionOf(file.fileName)));
	writeFileSync(destination, file.bytes);
	return destination;
}

async function recordFile(documentId: string, file: Resolved, path: string, db: Db): Promise<DocumentVersion> {
	return versions.record(
		{
			documentId,
			kind: "imported",
			source: file.source,
			pdfPath: path,
			fileName: file.fileName,
			mediaType: file.mediaType,
			byteSize: file.bytes.length,
			fileDate: file.fileDate,
			fileHash: versions.hashBytes(file.bytes),
			textContent: await matchText(file.bytes, file.fileName),
			mailAttachmentId: file.mailAttachmentId,
		},
		db,
	);
}

async function createDocument(
	file: Resolved,
	input: {
		clientId?: string | null;
		title?: string;
		projectId?: string | null;
		folderId?: string | null;
		issuedOn?: string;
	},
	db: Db,
): Promise<{ record: DocumentRecord; version: DocumentVersion }> {
	const place = resolvePlace(input, db);

	const title = input.title?.trim() || titleOf(file.fileName);
	// Compared case-insensitively and trimmed, because "Contract.pdf" and
	// "contract.pdf " are the same file to the person who dropped both. A
	// deleted document does not count, so removing one frees its name again.
	assertTitleFree(place, title, db);

	const destination = store(title, "-import", file);

	const [row] = db
		.insert(documents)
		.values({
			clientId: place.clientId,
			projectId: place.projectId,
			folderId: place.folderId,
			templateId: null,
			templateVersion: null,
			title,
			bodyHtml: "",
			issuedOn: input.issuedOn ?? todayIsoDate(),
			pdfPath: destination,
			isSpecimen: false,
			sourceKind: "imported",
		})
		.returning()
		.all();

	const version = await recordFile(row!.id, file, destination, db);
	const record = await get(row!.id, db);
	if (!record) throw new Error("The document was written but could not be read back.");
	return { record, version };
}

/** A new document from a file the window handed over. */
export async function importFile(input: ImportFileInput, db: Db = getDb()): Promise<DocumentRecord> {
	return (await createDocument(resolveSource(input.source, db), input, db)).record;
}

/**
 * A new document from a file on this machine, for the agent. Copied in, never
 * moved and never deleted, and the copy is what the record points at.
 */
export async function importPath(input: ImportDocumentInput, db: Db = getDb()): Promise<DocumentRecord> {
	return (await createDocument(resolvePath(input.sourcePath), input, db)).record;
}

async function appendVersion(documentId: string, file: Resolved, db: Db): Promise<DocumentVersion> {
	const record = await get(documentId, db);
	if (!record) throw new Error("That document no longer exists.");

	const hash = versions.hashBytes(file.bytes);
	const existing = versions.list(documentId, db).find((version) => version.fileHash === hash);
	if (existing) {
		throw new Error(`This exact file is already version ${existing.number} of ${record.title}.`);
	}

	return recordFile(documentId, file, store(record.title, "-versie", file), db);
}

/**
 * Adds a file to a document as one of its versions. Where it sits is decided by
 * the file's own date, so an older copy that arrives late does not become the
 * newest.
 */
export async function addVersion(input: AddVersionInput, db: Db = getDb()): Promise<DocumentVersion> {
	return appendVersion(input.documentId, resolveSource(input.source, db), db);
}

export async function addVersionFromPath(
	input: { documentId: string; sourcePath: string },
	db: Db = getDb(),
): Promise<DocumentVersion> {
	return appendVersion(input.documentId, resolvePath(input.sourcePath), db);
}

/**
 * A mail attachment kept as a document, any kind of file (decision 75). The
 * window asks `analyseImport` first with the attachment as the source and shows
 * what it looks like; this is the answer: `versionOf` adds it to that document,
 * otherwise it becomes a document of its own in the place given, or, with no
 * place, under the client the conversation is linked to.
 */
export async function importFromMail(input: ImportFromMailInput, db: Db = getDb()): Promise<ImportFromMailResult> {
	const file = resolveSource({ kind: "attachment", attachmentId: input.attachmentId }, db);
	if (input.versionOf) {
		const version = await appendVersion(input.versionOf, file, db);
		const document = await get(input.versionOf, db);
		if (!document) throw new Error("The version was written but the document could not be read back.");
		return { document, version, addedAsVersion: true };
	}
	const asked = input.clientId || input.projectId || input.folderId;
	const { record, version } = await createDocument(
		file,
		{
			...(asked
				? { clientId: input.clientId, projectId: input.projectId, folderId: input.folderId }
				: { clientId: file.threadClientId }),
			title: input.title,
		},
		db,
	);
	return { document: record, version, addedAsVersion: false };
}

/**
 * A PDF attached to a mail from this machine with "Add to documents" ticked,
 * kept once the mail has gone and not before. Kept under the mail's client and
 * project; when the two do not fit together, under the client alone.
 *
 * The same bytes already kept anywhere are not kept twice, and a file named
 * like a document in the same place becomes a new version of it, because
 * sending "Offerte.pdf" again is sending the next version of the offer.
 *
 * Still PDFs only: anything else a message carries is kept as a project file
 * (decision 49), and the composer says so.
 */
export async function keepSentFile(
	input: {
		data: Uint8Array;
		fileName: string;
		fileDate: string;
		clientId: string | null;
		projectId: string | null;
	},
	db: Db = getDb(),
): Promise<DocumentRecord> {
	const bytes = Buffer.from(input.data);
	const fileName = basename(input.fileName).trim() || "Document.pdf";
	if (!isPdfBytes(bytes)) {
		throw new Error(`"${fileName}" is not a PDF. Choose a file that starts with a PDF header.`);
	}
	checkFile(bytes, fileName);
	const file: Resolved = {
		bytes,
		fileName,
		fileDate: validDate(input.fileDate, new Date().toISOString()),
		mediaType: "application/pdf",
		source: "mail",
		mailAttachmentId: null,
		threadClientId: null,
	};

	let owner;
	try {
		owner = resolveOwner({ clientId: input.clientId, projectId: input.projectId }, db);
	} catch {
		owner = resolveOwner({ clientId: input.clientId }, db);
	}

	const hash = versions.hashBytes(bytes);
	const same = versions.fingerprints(db).find((row) => row.fileHash === hash);
	if (same) {
		const record = await get(same.documentId, db);
		if (record) return record;
	}

	const named = documentTitled(owner, titleOf(fileName), db);
	if (named) {
		await appendVersion(named.id, file, db);
		const record = await get(named.id, db);
		if (!record) throw new Error("The version was written but the document could not be read back.");
		return record;
	}
	return (await createDocument(file, { clientId: owner.clientId, projectId: owner.projectId }, db)).record;
}
