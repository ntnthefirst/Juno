/**
 * The sender: takes what the outbox has queued, sends it, and copies it into
 * the Sent folder. Reads `queued` and nothing else, so the gate in
 * ./mail-outbox.ts is the only way a message reaches it.
 *
 * One attempt claims the row (`queued` to `sending`) before anything touches
 * the network, so two ticks can never send the same message twice. A failure
 * to reach the server is retried a few times on later ticks; a refusal by the
 * server is final until a person presses retry.
 */
import { and, eq, isNull } from "drizzle-orm";
import { existsSync } from "node:fs";
import type { MailAddress, MailOutboxMessage } from "../../shared/types";
import { getDb, type Db } from "../db";
import { documentSignatures, documents, mailFolders } from "../db/schema";
import * as accounts from "./mail-accounts";
import * as outbox from "./mail-outbox";
import { describeMailError } from "./mail-source";
import { appendToSent, sendMessage, type OutgoingAttachment } from "./mail-transport";
import * as settings from "./settings";

const BATCH = 5;
const MAX_AUTOMATIC_ATTEMPTS = 3;
const TICK_MS = 30 * 1000;

type Listener = (message: MailOutboxMessage) => void;

interface SendConfig {
	isPaused?: () => boolean;
	/**
	 * Renders a document's PDF and returns its path. Injected because the real
	 * renderer needs an Electron window, and this module has to run in a test.
	 */
	renderDocumentPdf?: (documentId: string) => Promise<string | null>;
}

let config: SendConfig = {};
let timer: NodeJS.Timeout | null = null;
let running = false;
const listeners = new Set<Listener>();

export function configureMailSend(next: SendConfig): void {
	config = next;
}

export function onChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

async function publish(id: string, db: Db): Promise<void> {
	const record = await outbox.get(id, db);
	if (record) for (const listener of listeners) listener(record);
}

/** A connection-level failure is worth another go; a server saying no is not. */
function isTransient(error: unknown): boolean {
	const code = (error as { code?: string; responseCode?: number }).code;
	const response = (error as { responseCode?: number }).responseCode;
	if (response !== undefined) return response >= 400 && response < 500;
	return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ETIMEOUT", "EAI_AGAIN", "ENOTFOUND", "ESOCKET", "ECONNECTION"].includes(code ?? "");
}

/**
 * The file for a document attachment: the signed PDF when there is one, the
 * rendered PDF otherwise, rendered now if it never was.
 */
async function resolveAttachment(
	db: Db,
	attachment: { documentId: string; filename: string },
): Promise<OutgoingAttachment> {
	const signed = db
		.select({ path: documentSignatures.signedPdfPath })
		.from(documentSignatures)
		.where(eq(documentSignatures.documentId, attachment.documentId))
		.all()
		.map((r) => r.path)
		.filter((p): p is string => Boolean(p))
		.pop();
	let path = signed ?? null;
	if (!path) {
		const document = db
			.select({ pdfPath: documents.pdfPath })
			.from(documents)
			.where(and(eq(documents.id, attachment.documentId), isNull(documents.deletedAt)))
			.get();
		if (!document) throw new Error(`The attached document "${attachment.filename}" no longer exists.`);
		path = document.pdfPath;
		if (!path || !existsSync(path)) {
			if (!config.renderDocumentPdf) {
				throw new Error(`"${attachment.filename}" has no PDF yet. Open the document and render it first.`);
			}
			path = await config.renderDocumentPdf(attachment.documentId);
		}
	}
	if (!path || !existsSync(path)) {
		throw new Error(`The PDF for "${attachment.filename}" could not be found or rendered.`);
	}
	return { filename: attachment.filename, path, contentType: "application/pdf" };
}

async function sendOne(message: outbox.QueuedMessage, db: Db): Promise<void> {
	if (!outbox.markSending(message.id, db)) return;
	await publish(message.id, db);

	let connection: { host: string; username: string } = { host: "", username: "" };
	try {
		const smtp = accounts.smtpConnectionFor(message.accountId, db);
		connection = smtp;
		const owner = await settings.getOwner();
		const from: MailAddress = {
			name: smtp.fromName || owner.contactName || owner.businessName || null,
			address: smtp.fromAddress,
		};
		const attachments: OutgoingAttachment[] = [];
		for (const attachment of message.attachments) {
			attachments.push(await resolveAttachment(db, attachment));
		}

		const result = await sendMessage(smtp, {
			messageId: message.messageId,
			from,
			to: message.to,
			cc: message.cc,
			bcc: message.bcc,
			subject: message.subject,
			text: message.bodyText,
			html: message.bodyHtml,
			inReplyTo: message.inReplyTo,
			references: message.references,
			attachments,
		});
		if (result.rejected.length > 0 && result.accepted.length === 0) {
			throw Object.assign(new Error(`The server refused every recipient: ${result.rejected.join(", ")}.`), {
				responseCode: 550,
			});
		}
		outbox.markSent(message.id, db);
		await publish(message.id, db);

		// The copy in Sent is a courtesy to the phone, not part of sending. Its
		// failure is recorded on the row and never turns a sent message into a
		// failed one.
		try {
			const sent = db
				.select({ path: mailFolders.path })
				.from(mailFolders)
				.where(
					and(
						eq(mailFolders.accountId, message.accountId),
						eq(mailFolders.specialUse, "sent"),
						isNull(mailFolders.deletedAt),
					),
				)
				.get();
			if (!sent) {
				outbox.markAppended(message.id, "No Sent folder is known for this account yet. Sync it once.", db);
			} else {
				const imap = accounts.connectionFor(message.accountId, db);
				await appendToSent(imap, sent.path, result.raw, new Date().toISOString());
				outbox.markAppended(message.id, null, db);
			}
		} catch (error) {
			outbox.markAppended(message.id, describeMailError(error, connection), db);
		}
	} catch (error) {
		const attempts = message.attempts + 1;
		const requeue = isTransient(error) && attempts < MAX_AUTOMATIC_ATTEMPTS;
		const text =
			error instanceof Error && !(error as { code?: string }).code && !(error as { responseCode?: number }).responseCode
				? error.message
				: describeMailError(error, connection);
		outbox.markFailed(message.id, requeue ? `${text} Trying again shortly.` : text, requeue, db);
	}
	await publish(message.id, db);
}

/** One pass over the queue. Safe to call from anywhere; a second call waits its turn. */
export async function processQueue(db: Db = getDb()): Promise<number> {
	if (running || config.isPaused?.()) return 0;
	running = true;
	let sent = 0;
	try {
		const queued = await outbox.nextQueued(BATCH, db);
		for (const message of queued) {
			if (config.isPaused?.()) break;
			await sendOne(message, db);
			sent += 1;
		}
	} finally {
		running = false;
	}
	return sent;
}

let unsubscribe: (() => void) | null = null;

/** A tick every half minute, and a run the moment something is queued. */
export function startScheduler(): void {
	if (timer) return;
	timer = setInterval(() => void processQueue().catch(() => undefined), TICK_MS);
	timer.unref();
	unsubscribe = outbox.onQueued(() => {
		// Deferred a tick so the row is committed and the caller has its answer
		// before the network is touched.
		setTimeout(() => void processQueue().catch(() => undefined), 50);
	});
}

export function stopScheduler(): void {
	if (timer) clearInterval(timer);
	timer = null;
	unsubscribe?.();
	unsubscribe = null;
}

/** Test seam. Never called by application code. */
export function resetForTests(): void {
	stopScheduler();
	running = false;
	listeners.clear();
	config = {};
}
