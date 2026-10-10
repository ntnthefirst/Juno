/**
 * Bringing a PDF in: as a document of its own, or as a new version of one that
 * exists, and working out which of the two it probably is.
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
import type {
	AddVersionInput,
	DocumentVersion,
	DocumentVersionSource,
	ImportAnalysis,
	ImportDocumentInput,
	ImportFileInput,
	ImportMatch,
	ImportSource,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { documents, mailAttachments, mailMessages, mailThreads } from "../db/schema";
import { todayIsoDate } from "./document-context";
import * as versions from "./document-versions";
import { resolveOwner } from "./document-owner";
import { documentStorageDir, fileNameFor, get, type DocumentRecord } from "./documents";
import { attachmentPath } from "./mail-threads";
import { compareText, extractText } from "./pdf-text";

/** Largest PDF that can be brought in. A contract does not need to be bigger. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** How many documents an analysis offers. More than this is a list nobody reads. */
const MAX_MATCHES = 5;

interface Resolved {
	bytes: Buffer;
	fileName: string;
	fileDate: string;
	source: DocumentVersionSource;
	mailAttachmentId: string | null;
	/** The client the mail thread is linked to, when it came from mail. */
	threadClientId: string | null;
}

function validDate(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return fallback;
	// A clock set wrong on the machine that saved the file should not make it
	// the newest version for years.
	const nowIso = new Date().toISOString();
	const iso = date.toISOString();
	return iso > nowIso ? nowIso : iso;
}

function checkPdf(bytes: Buffer, label: string): void {
	if (bytes.length === 0 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
		throw new Error(`"${label}" is not a PDF. Choose a file that starts with a PDF header.`);
	}
	if (bytes.length > MAX_IMPORT_BYTES) {
		throw new Error(`"${label}" is larger than 50 MB. Split it or compress it first.`);
	}
}

/** The only place a window-supplied source is turned into bytes. */
function resolve(source: ImportSource, db: Db): Resolved {
	if (source.kind === "bytes") {
		const bytes = Buffer.from(source.data);
		const fileName = basename(String(source.fileName ?? "")).trim() || "Document.pdf";
		checkPdf(bytes, fileName);
		return {
			bytes,
			fileName,
			fileDate: validDate(source.fileDate, new Date().toISOString()),
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
		checkPdf(bytes, filename);
		return {
			bytes,
			fileName: filename,
			fileDate: validDate(row.messageDate ?? row.internalDate, new Date().toISOString()),
			source: "mail",
			mailAttachmentId: source.attachmentId,
			threadClientId: row.clientId,
		};
	}
	throw new Error("A file can only be brought in from a drop, the file picker or a mail attachment.");
}

/** For the agent's tools, which name a file on this machine. */
function resolvePath(sourcePath: string): Resolved {
	const label = basename(sourcePath);
	if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
		throw new Error(`Could not find "${label}". Check the file still exists at that location.`);
	}
	const bytes = readFileSync(sourcePath);
	checkPdf(bytes, label);
	return {
		bytes,
		fileName: label,
		fileDate: validDate(statSync(sourcePath).mtime.toISOString(), new Date().toISOString()),
		source: "agent",
		mailAttachmentId: null,
		threadClientId: null,
	};
}

function titleOf(fileName: string): string {
	return fileName.replace(/\.pdf$/i, "").trim() || "Document";
}

/**
 * The live document with this title in the same place: under the same client,
 * or, for one with no client, under the same project, or among the documents
 * kept under nothing. Compared the way a person would.
 */
function documentTitled(place: { clientId: string | null; projectId: string | null }, title: string, db: Db) {
	const wanted = title.trim().toLowerCase();
	const where = place.clientId
		? eq(documents.clientId, place.clientId)
		: place.projectId
			? and(isNull(documents.clientId), eq(documents.projectId, place.projectId))
			: and(isNull(documents.clientId), isNull(documents.projectId));
	return (
		db
			.select({ id: documents.id, title: documents.title })
			.from(documents)
			.where(and(where, isNull(documents.deletedAt)))
			.all()
			.find((row) => row.title.trim().toLowerCase() === wanted) ?? null
	);
}

/**
 * Which existing documents the file looks like: the same bytes, the same text
 * with a signature or a stamp added, or, for the client it is going to, the
 * same name.
 */
async function analyse(file: Resolved, clientId: string | null, db: Db): Promise<ImportAnalysis> {
	const hash = versions.hashBytes(file.bytes);
	const text = await extractText(file.bytes);

	const best = new Map<string, { score: number; identical: boolean }>();
	for (const row of versions.fingerprints(db)) {
		const identical = row.fileHash === hash;
		const score = identical
			? 1
			: text && row.textContent
				? (() => {
						const match = compareText(text, row.textContent);
						return match.same ? match.score : 0;
					})()
				: 0;
		if (score === 0) continue;
		const current = best.get(row.documentId);
		if (!current || identical || score > current.score) {
			best.set(row.documentId, { score, identical: identical || (current?.identical ?? false) });
		}
	}

	const defaultTitle = titleOf(file.fileName);
	const wantedClient = clientId ?? file.threadClientId;
	const named = wantedClient ? documentTitled({ clientId: wantedClient, projectId: null }, defaultTitle, db) : null;
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
			score: found?.score ?? 0,
			identical: found?.identical ?? false,
			reason: found ? "text" : "name",
		});
	}
	matches.sort(
		(a, b) =>
			Number(b.identical) - Number(a.identical) ||
			Number(b.clientId === wantedClient) - Number(a.clientId === wantedClient) ||
			b.score - a.score,
	);

	return {
		fileName: file.fileName,
		defaultTitle,
		suggestedClientId: wantedClient ?? matches[0]?.clientId ?? null,
		matches: matches.slice(0, MAX_MATCHES),
		fileDate: file.fileDate,
	};
}

export async function analyseImport(
	input: { source: ImportSource; clientId?: string | null },
	db: Db = getDb(),
): Promise<ImportAnalysis> {
	return analyse(resolve(input.source, db), input.clientId ?? null, db);
}

export async function analysePath(
	input: { sourcePath: string; clientId?: string | null },
	db: Db = getDb(),
): Promise<ImportAnalysis> {
	return analyse(resolvePath(input.sourcePath), input.clientId ?? null, db);
}

async function createDocument(
	file: Resolved,
	input: { clientId?: string | null; title?: string; projectId?: string | null; issuedOn?: string },
	db: Db,
): Promise<DocumentRecord> {
	const owner = resolveOwner(input, db);

	const title = input.title?.trim() || titleOf(file.fileName);
	// Compared case-insensitively and trimmed, because "Contract.pdf" and
	// "contract.pdf " are the same file to the person who dropped both. A
	// deleted document does not count, so removing one frees its name again.
	if (documentTitled(owner, title, db)) {
		const where = owner.clientName ?? owner.projectName;
		throw new Error(
			`${where ? `${where} already has` : "There is already"} a document named "${title}". Add the file as a new version of it, or give it another name.`,
		);
	}

	// The stored name comes from the title through fileNameFor, never from the
	// name the file arrived with, so "../" in either cannot leave the folder.
	const destination = join(documentStorageDir(), fileNameFor(title, "-import"));
	writeFileSync(destination, file.bytes);

	const [row] = db
		.insert(documents)
		.values({
			clientId: owner.clientId,
			projectId: owner.projectId,
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

	versions.record(
		{
			documentId: row!.id,
			kind: "imported",
			source: file.source,
			pdfPath: destination,
			fileName: file.fileName,
			fileDate: file.fileDate,
			fileHash: versions.hashBytes(file.bytes),
			textContent: await extractText(file.bytes),
			mailAttachmentId: file.mailAttachmentId,
		},
		db,
	);

	const record = await get(row!.id, db);
	if (!record) throw new Error("The document was written but could not be read back.");
	return record;
}

/** A new document from a file the window handed over. */
export async function importFile(input: ImportFileInput, db: Db = getDb()): Promise<DocumentRecord> {
	return createDocument(resolve(input.source, db), input, db);
}

/**
 * A new document from a file on this machine, for the agent. Copied in, never
 * moved and never deleted, and the copy is what the record points at.
 */
export async function importPdf(input: ImportDocumentInput, db: Db = getDb()): Promise<DocumentRecord> {
	return createDocument(resolvePath(input.sourcePath), input, db);
}

async function appendVersion(documentId: string, file: Resolved, db: Db): Promise<DocumentVersion> {
	const record = await get(documentId, db);
	if (!record) throw new Error("That document no longer exists.");

	const hash = versions.hashBytes(file.bytes);
	const existing = versions.list(documentId, db).find((version) => version.fileHash === hash);
	if (existing) {
		throw new Error(`This exact file is already version ${existing.number} of ${record.title}.`);
	}

	const destination = join(documentStorageDir(), fileNameFor(record.title, "-versie"));
	writeFileSync(destination, file.bytes);
	return versions.record(
		{
			documentId,
			kind: "imported",
			source: file.source,
			pdfPath: destination,
			fileName: file.fileName,
			fileDate: file.fileDate,
			fileHash: hash,
			textContent: await extractText(file.bytes),
			mailAttachmentId: file.mailAttachmentId,
		},
		db,
	);
}

/**
 * Adds a file to a document as one of its versions. Where it sits is decided by
 * the file's own date, so an older copy that arrives late does not become the
 * newest.
 */
export async function addVersion(input: AddVersionInput, db: Db = getDb()): Promise<DocumentVersion> {
	return appendVersion(input.documentId, resolve(input.source, db), db);
}

export async function addVersionFromPath(
	input: { documentId: string; sourcePath: string },
	db: Db = getDb(),
): Promise<DocumentVersion> {
	return appendVersion(input.documentId, resolvePath(input.sourcePath), db);
}
