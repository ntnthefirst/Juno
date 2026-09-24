/**
 * The outbox: drafts, the confirmation gate, and the queue the sender reads.
 *
 * The gate is the reason this file exists. A message reaches `queued` through
 * `requestSend` and `approve` and nothing else, and `requestSend` puts an
 * agent's message in `pending` rather than `queued`. `approve` has no MCP tool
 * and never will: a person in the app is the only thing that turns pending
 * into queued (.claude/rules/mcp.md section 4). The sender in ./mail-send.ts
 * reads `queued` and nothing else.
 *
 * Decision 9 still holds here: an invoice nudge carries a title and an amount
 * typed by the owner, and Juno never numbers or issues one.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
	MailAddress,
	MailDraftInput,
	MailDraftPatch,
	MailOutboxAttachment,
	MailOutboxCounts,
	MailMessageClient,
	MailOutboxListQuery,
	MailOutboxMessage,
	MailOutboxState,
	MailReplyMode,
	MailReplySeed,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import {
	clients,
	documents,
	mailAccounts,
	mailMessages,
	mailOutbox,
	mailOutboxAttachments,
	mailOutboxClients,
	mailThreads,
} from "../db/schema";
import { formatDateTime } from "./document-context";
import { htmlToText, mailShell, quoteForReply, textToHtml } from "./mail-html";
import { clientsFor } from "./mail-recipients";
import { footerLines } from "./mail-templates";

export type Actor = "user" | "agent";

/**
 * Fired whenever a message reaches the queue, so the sender can run at once
 * rather than on its next tick. The sender subscribes; nothing here knows it.
 */
const queuedListeners = new Set<() => void>();

export function onQueued(listener: () => void): () => void {
	queuedListeners.add(listener);
	return () => queuedListeners.delete(listener);
}

function notifyQueued(): void {
	for (const listener of queuedListeners) listener();
}

type Row = typeof mailOutbox.$inferSelect;

const STATES: MailOutboxState[] = ["draft", "pending", "queued", "sending", "sent", "failed", "cancelled"];

function parseAddresses(json: string): MailAddress[] {
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value)
			? value.filter(
					(v): v is MailAddress =>
						typeof v === "object" && v !== null && typeof (v as MailAddress).address === "string",
				)
			: [];
	} catch {
		return [];
	}
}

function parseReferences(json: string): string[] {
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
}

function cleanAddresses(list: MailAddress[] | undefined, label: string): MailAddress[] {
	const out: MailAddress[] = [];
	for (const entry of list ?? []) {
		const address = entry.address.trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
			throw new Error(`"${entry.address}" in ${label} is not an email address.`);
		}
		if (out.some((a) => a.address === address)) continue;
		out.push({ name: entry.name?.trim() || null, address });
	}
	return out;
}

function attachmentsFor(db: Db, outboxIds: string[]): Map<string, MailOutboxAttachment[]> {
	const out = new Map<string, MailOutboxAttachment[]>();
	if (outboxIds.length === 0) return out;
	const rows = db
		.select()
		.from(mailOutboxAttachments)
		.where(and(inArray(mailOutboxAttachments.outboxId, outboxIds), isNull(mailOutboxAttachments.deletedAt)))
		.orderBy(asc(mailOutboxAttachments.createdAt))
		.all();
	for (const row of rows) {
		const list = out.get(row.outboxId) ?? [];
		list.push({ id: row.id, documentId: row.documentId, filename: row.filename });
		out.set(row.outboxId, list);
	}
	return out;
}

/** Every client each message concerns, by message id. */
function clientsOf(db: Db, outboxIds: string[]): Map<string, MailMessageClient[]> {
	const out = new Map<string, MailMessageClient[]>();
	if (outboxIds.length === 0) return out;
	const rows = db
		.select({
			outboxId: mailOutboxClients.outboxId,
			clientId: mailOutboxClients.clientId,
			clientName: clients.name,
			matchedAddress: mailOutboxClients.matchedAddress,
		})
		.from(mailOutboxClients)
		.innerJoin(clients, eq(clients.id, mailOutboxClients.clientId))
		.where(and(inArray(mailOutboxClients.outboxId, outboxIds), isNull(mailOutboxClients.deletedAt)))
		.orderBy(asc(mailOutboxClients.createdAt))
		.all();
	for (const row of rows) {
		const list = out.get(row.outboxId) ?? [];
		list.push({
			clientId: row.clientId,
			clientName: row.clientName,
			matchedAddress: row.matchedAddress,
		});
		out.set(row.outboxId, list);
	}
	return out;
}

/**
 * Rewrites which clients a message concerns from its addresses, and returns
 * them. Rows that no longer match are soft-deleted rather than removed, like
 * everything else here, so a link that was there is still visible in the file.
 */
async function relinkClients(db: Db, outboxId: string, addresses: string[]): Promise<MailMessageClient[]> {
	const resolved = await clientsFor(addresses, db);
	const stamp = now();
	const existing = db
		.select()
		.from(mailOutboxClients)
		.where(eq(mailOutboxClients.outboxId, outboxId))
		.all();
	db.transaction(() => {
		for (const row of existing) {
			const keep = resolved.find((entry) => entry.clientId === row.clientId);
			if (keep && row.deletedAt === null) continue;
			if (keep) {
				db.update(mailOutboxClients)
					.set({ deletedAt: null, matchedAddress: keep.matchedAddress, updatedAt: stamp })
					.where(eq(mailOutboxClients.id, row.id))
					.run();
			} else if (row.deletedAt === null) {
				db.update(mailOutboxClients)
					.set({ deletedAt: stamp, updatedAt: stamp })
					.where(eq(mailOutboxClients.id, row.id))
					.run();
			}
		}
		for (const entry of resolved) {
			if (existing.some((row) => row.clientId === entry.clientId)) continue;
			db.insert(mailOutboxClients)
				.values({
					outboxId,
					clientId: entry.clientId,
					matchedAddress: entry.matchedAddress,
					createdAt: stamp,
					updatedAt: stamp,
				})
				.run();
		}
	});
	return resolved.map((entry) => ({
		clientId: entry.clientId,
		clientName: entry.clientName,
		matchedAddress: entry.matchedAddress,
	}));
}

function toRecord(
	row: Row,
	clientName: string | null,
	attachments: MailOutboxAttachment[],
	messageClients: MailMessageClient[],
): MailOutboxMessage {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		accountId: row.accountId,
		state: row.state as MailOutboxState,
		to: parseAddresses(row.toJson),
		cc: parseAddresses(row.ccJson),
		bcc: parseAddresses(row.bccJson),
		subject: row.subject,
		bodyText: row.bodyText,
		bodyHtml: row.bodyHtml,
		messageId: row.messageId,
		inReplyTo: row.inReplyTo,
		replyToMessageId: row.replyToMessageId,
		threadId: row.threadId,
		clientId: row.clientId,
		clientName,
		clients: messageClients,
		projectId: row.projectId,
		templateId: row.templateId,
		requestedBy: row.requestedBy as Actor,
		approvedAt: row.approvedAt,
		queuedAt: row.queuedAt,
		attempts: row.attempts,
		lastError: row.lastError,
		sentAt: row.sentAt,
		appendedToSentAt: row.appendedToSentAt,
		appendError: row.appendError,
		attachments,
	};
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(mailOutbox)
		.where(and(eq(mailOutbox.id, id), isNull(mailOutbox.deletedAt)))
		.get();
	if (!row) throw new Error("That message does not exist.");
	return row;
}

export async function get(id: string, db: Db = getDb()): Promise<MailOutboxMessage | null> {
	const row = db
		.select({ outbox: mailOutbox, clientName: clients.name })
		.from(mailOutbox)
		.leftJoin(clients, eq(mailOutbox.clientId, clients.id))
		.where(and(eq(mailOutbox.id, id), isNull(mailOutbox.deletedAt)))
		.get();
	if (!row) return null;
	return toRecord(
		row.outbox,
		row.clientName,
		attachmentsFor(db, [id]).get(id) ?? [],
		clientsOf(db, [id]).get(id) ?? [],
	);
}

async function requireRecord(id: string, db: Db): Promise<MailOutboxMessage> {
	const record = await get(id, db);
	if (!record) throw new Error("That message does not exist.");
	return record;
}

export async function list(query: MailOutboxListQuery = {}, db: Db = getDb()): Promise<MailOutboxMessage[]> {
	const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
	const conditions = [isNull(mailOutbox.deletedAt)];
	if (query.accountId) conditions.push(eq(mailOutbox.accountId, query.accountId));
	if (query.states && query.states.length > 0) {
		for (const state of query.states) {
			if (!STATES.includes(state)) throw new Error(`"${state}" is not an outbox state.`);
		}
		conditions.push(inArray(mailOutbox.state, query.states));
	}
	const rows = db
		.select({ outbox: mailOutbox, clientName: clients.name })
		.from(mailOutbox)
		.leftJoin(clients, eq(mailOutbox.clientId, clients.id))
		.where(and(...conditions))
		.orderBy(desc(mailOutbox.updatedAt))
		.limit(limit)
		.all();
	const ids = rows.map((r) => r.outbox.id);
	const attachments = attachmentsFor(db, ids);
	const linked = clientsOf(db, ids);
	return rows.map((r) =>
		toRecord(r.outbox, r.clientName, attachments.get(r.outbox.id) ?? [], linked.get(r.outbox.id) ?? []),
	);
}

/** What the sidebar shows next to the outbox: what is waiting on whom. */
export async function counts(accountId?: string, db: Db = getDb()): Promise<MailOutboxCounts> {
	const conditions = [isNull(mailOutbox.deletedAt)];
	if (accountId) conditions.push(eq(mailOutbox.accountId, accountId));
	const rows = db
		.select({ state: mailOutbox.state, n: sql<number>`count(*)` })
		.from(mailOutbox)
		.where(and(...conditions))
		.groupBy(mailOutbox.state)
		.all();
	const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
	return {
		pending: by.pending ?? 0,
		queued: (by.queued ?? 0) + (by.sending ?? 0),
		failed: by.failed ?? 0,
		drafts: by.draft ?? 0,
	};
}

/**
 * Turns a text body into the stored pair: the text as typed, and the text as
 * HTML in the house shell. A body that arrived as HTML from a template keeps
 * its HTML and gets a text twin.
 */
async function bodies(input: { bodyText: string; bodyHtml?: string | null }): Promise<{ bodyText: string; bodyHtml: string }> {
	if (input.bodyHtml) {
		return {
			bodyText: input.bodyText.trim() || htmlToText(input.bodyHtml),
			bodyHtml: input.bodyHtml,
		};
	}
	return {
		bodyText: input.bodyText,
		bodyHtml: mailShell(textToHtml(input.bodyText), { footerLines: await footerLines() }),
	};
}

function messageIdFor(fromAddress: string): string {
	const domain = fromAddress.split("@")[1] || "juno.local";
	return `<${uuidv7()}@${domain}>`;
}

async function attachDocuments(db: Db, outboxId: string, documentIds: string[]): Promise<void> {
	const stamp = now();
	for (const documentId of [...new Set(documentIds)]) {
		const document = db
			.select({ id: documents.id, title: documents.title })
			.from(documents)
			.where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
			.get();
		if (!document) throw new Error("One of the documents to attach does not exist.");
		db.insert(mailOutboxAttachments)
			.values({
				outboxId,
				documentId,
				filename: `${document.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "document"}.pdf`,
				createdAt: stamp,
				updatedAt: stamp,
			})
			.run();
	}
}

/**
 * The threading headers and thread of the message being answered, so a reply
 * lands in the same conversation on both ends.
 */
function replyHeaders(db: Db, replyToMessageId: string | null | undefined): {
	inReplyTo: string | null;
	references: string[];
	threadId: string | null;
	clientId: string | null;
} {
	if (!replyToMessageId) return { inReplyTo: null, references: [], threadId: null, clientId: null };
	const original = db
		.select({
			messageId: mailMessages.messageId,
			referencesJson: mailMessages.referencesJson,
			threadId: mailMessages.threadId,
			clientId: mailThreads.clientId,
		})
		.from(mailMessages)
		.leftJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
		.where(and(eq(mailMessages.id, replyToMessageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!original) throw new Error("The message being answered no longer exists.");
	const references = parseReferences(original.referencesJson);
	if (original.messageId && !references.includes(original.messageId)) references.push(original.messageId);
	return {
		inReplyTo: original.messageId,
		references,
		threadId: original.threadId,
		clientId: original.clientId ?? null,
	};
}

export async function createDraft(input: MailDraftInput, db: Db = getDb()): Promise<MailOutboxMessage> {
	const account = db
		.select()
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, input.accountId), isNull(mailAccounts.deletedAt)))
		.get();
	if (!account) throw new Error("That mail account does not exist.");

	const to = cleanAddresses(input.to, "To");
	const cc = cleanAddresses(input.cc, "Cc");
	const bcc = cleanAddresses(input.bcc, "Bcc");
	const reply = replyHeaders(db, input.replyToMessageId);
	const body = await bodies({ bodyText: input.bodyText ?? "", bodyHtml: input.bodyHtml });
	const stamp = now();
	const id = uuidv7();

	db.transaction(() => {
		db.insert(mailOutbox)
			.values({
				id,
				accountId: account.id,
				state: "draft",
				toJson: JSON.stringify(to),
				ccJson: JSON.stringify(cc),
				bccJson: JSON.stringify(bcc),
				subject: input.subject?.trim() ?? "",
				bodyText: body.bodyText,
				bodyHtml: body.bodyHtml,
				messageId: messageIdFor(account.email),
				inReplyTo: reply.inReplyTo,
				referencesJson: JSON.stringify(reply.references),
				replyToMessageId: input.replyToMessageId ?? null,
				threadId: reply.threadId,
				clientId: input.clientId ?? reply.clientId,
				projectId: input.projectId ?? null,
				templateId: input.templateId ?? null,
				requestedBy: "user",
				createdAt: stamp,
				updatedAt: stamp,
			})
			.run();
	});
	await attachDocuments(db, id, input.documentIds ?? []);
	await relinkClients(db, id, [...to, ...cc, ...bcc].map((a) => a.address));
	// Filed under the client the recipients point at, unless the caller said
	// which, or this is a reply and the thread already belongs to one.
	if (!input.clientId && !reply.clientId) {
		const [first] = clientsOf(db, [id]).get(id) ?? [];
		if (first) {
			db.update(mailOutbox)
				.set({ clientId: first.clientId, updatedAt: now() })
				.where(eq(mailOutbox.id, id))
				.run();
		}
	}
	return requireRecord(id, db);
}

export async function updateDraft(id: string, patch: MailDraftPatch, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state !== "draft" && row.state !== "failed" && row.state !== "pending") {
		throw new Error("Only a draft, a pending or a failed message can be edited.");
	}
	const values: Partial<typeof mailOutbox.$inferInsert> = { updatedAt: now() };
	if (patch.to !== undefined) values.toJson = JSON.stringify(cleanAddresses(patch.to, "To"));
	if (patch.cc !== undefined) values.ccJson = JSON.stringify(cleanAddresses(patch.cc, "Cc"));
	if (patch.bcc !== undefined) values.bccJson = JSON.stringify(cleanAddresses(patch.bcc, "Bcc"));
	if (patch.subject !== undefined) values.subject = patch.subject.trim();
	if (patch.bodyText !== undefined || patch.bodyHtml !== undefined) {
		const body = await bodies({
			bodyText: patch.bodyText ?? (patch.bodyHtml ? "" : row.bodyText),
			bodyHtml: patch.bodyHtml === undefined ? (patch.bodyText !== undefined ? null : row.bodyHtml) : patch.bodyHtml,
		});
		values.bodyText = body.bodyText;
		values.bodyHtml = body.bodyHtml;
	}
	if (patch.clientId !== undefined) values.clientId = patch.clientId;
	if (patch.projectId !== undefined) values.projectId = patch.projectId;
	if (patch.templateId !== undefined) values.templateId = patch.templateId;
	if (patch.replyToMessageId !== undefined) {
		const reply = replyHeaders(db, patch.replyToMessageId);
		values.replyToMessageId = patch.replyToMessageId;
		values.inReplyTo = reply.inReplyTo;
		values.referencesJson = JSON.stringify(reply.references);
		values.threadId = reply.threadId;
	}
	// An edited pending message is no longer what the agent asked to send; it
	// becomes the person's draft.
	if (row.state === "pending") {
		values.state = "draft";
		values.requestedBy = "user";
	}

	db.transaction(() => {
		db.update(mailOutbox).set(values).where(eq(mailOutbox.id, id)).run();
		if (patch.documentIds !== undefined) {
			db.delete(mailOutboxAttachments).where(eq(mailOutboxAttachments.outboxId, id)).run();
		}
	});
	if (patch.documentIds !== undefined) await attachDocuments(db, id, patch.documentIds);
	if (patch.to !== undefined || patch.cc !== undefined || patch.bcc !== undefined) {
		const current = requireRow(id, db);
		await relinkClients(db, id, [
			...parseAddresses(current.toJson),
			...parseAddresses(current.ccJson),
			...parseAddresses(current.bccJson),
		].map((a) => a.address));
	}
	return requireRecord(id, db);
}

/** The marker the template renderer leaves where a value was missing. */
const MISSING_MARKER = /\[ontbreekt: ([\w.]+)\]/g;

function validateSendable(row: Row, account: typeof mailAccounts.$inferSelect): void {
	if (parseAddresses(row.toJson).length === 0) throw new Error("The message has nobody in To.");
	if (!row.subject.trim()) throw new Error("The message has no subject.");
	if (!row.bodyText.trim() && !row.bodyHtml) throw new Error("The message is empty.");
	// A template gap must never reach a client. The marker is visible in the
	// composer for exactly this reason, and the gate is where it is enforced.
	const gaps = new Set<string>();
	for (const text of [row.subject, row.bodyText, row.bodyHtml ?? ""]) {
		for (const match of text.matchAll(MISSING_MARKER)) gaps.add(match[1]!);
	}
	if (gaps.size > 0) {
		throw new Error(
			`The message still has a placeholder without a value: ${[...gaps].join(", ")}. Fill in the record or the field, then fill the template in again.`,
		);
	}
	if (!account.smtpHost) {
		throw new Error(`${account.email} has no outgoing server. Add one in account settings.`);
	}
}

/**
 * The gate. A person's request goes straight to the queue: the press was the
 * confirmation. An agent's request waits in `pending` until a person approves
 * it in the app, and nothing an agent can call moves it further.
 */
export async function requestSend(id: string, options: { actor: Actor }, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state !== "draft" && row.state !== "failed" && row.state !== "pending") {
		throw new Error(`A ${row.state} message cannot be sent again.`);
	}
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, row.accountId)).get();
	if (!account || account.deletedAt) throw new Error("The account this message belongs to no longer exists.");
	validateSendable(row, account);

	const stamp = now();
	if (options.actor === "agent") {
		db.update(mailOutbox)
			.set({ state: "pending", requestedBy: "agent", approvedAt: null, updatedAt: stamp })
			.where(eq(mailOutbox.id, id))
			.run();
	} else {
		db.update(mailOutbox)
			.set({ state: "queued", requestedBy: "user", approvedAt: stamp, queuedAt: stamp, lastError: null, updatedAt: stamp })
			.where(eq(mailOutbox.id, id))
			.run();
		notifyQueued();
	}
	return requireRecord(id, db);
}

/** A person approving what an agent prepared. No MCP tool calls this. */
export async function approve(id: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state !== "pending") throw new Error("Only a pending message can be approved.");
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, row.accountId)).get();
	if (!account || account.deletedAt) throw new Error("The account this message belongs to no longer exists.");
	validateSendable(row, account);
	const stamp = now();
	db.update(mailOutbox)
		.set({ state: "queued", approvedAt: stamp, queuedAt: stamp, lastError: null, updatedAt: stamp })
		.where(eq(mailOutbox.id, id))
		.run();
	notifyQueued();
	return requireRecord(id, db);
}

/** Withdraws a message that has not gone out. A sent message cannot be unsent. */
export async function cancel(id: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state === "sent" || row.state === "sending") {
		throw new Error(`A ${row.state} message cannot be cancelled.`);
	}
	db.update(mailOutbox)
		.set({ state: "cancelled", updatedAt: now() })
		.where(eq(mailOutbox.id, id))
		.run();
	return requireRecord(id, db);
}

/** Puts a failed message back in the queue, under the same Message-ID. */
export async function retry(id: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state !== "failed") throw new Error("Only a failed message can be retried.");
	const stamp = now();
	db.update(mailOutbox)
		.set({ state: "queued", queuedAt: stamp, updatedAt: stamp })
		.where(eq(mailOutbox.id, id))
		.run();
	notifyQueued();
	return requireRecord(id, db);
}

/** Soft-deletes a draft or a cancelled message. Anything else stays as history. */
export async function remove(id: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state !== "draft" && row.state !== "cancelled" && row.state !== "failed") {
		throw new Error(`A ${row.state} message stays in the outbox as a record.`);
	}
	const stamp = now();
	db.update(mailOutbox)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailOutbox.id, id))
		.run();
	return toRecord({ ...row, deletedAt: stamp }, null, [], []);
}

/**
 * What an answer starts from.
 *
 * A plain reply goes to the sender, or to Reply-To when the sender asked for
 * that. Reply-all keeps everyone on the original except the account itself. A
 * forward keeps the text and nothing else: it has no recipients, because the
 * person forwarding it chooses those, and it carries no threading headers,
 * because it is a new conversation rather than a turn in this one.
 */
export async function replySeed(
	messageId: string,
	options: { mode: MailReplyMode },
	db: Db = getDb(),
): Promise<MailReplySeed> {
	const row = db
		.select({ message: mailMessages, clientId: mailThreads.clientId })
		.from(mailMessages)
		.leftJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
		.where(and(eq(mailMessages.id, messageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) throw new Error("That message does not exist.");
	const message = row.message;
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, message.accountId)).get();
	if (!account) throw new Error("The account this message belongs to no longer exists.");

	const own = new Set([account.email.toLowerCase(), account.username.toLowerCase()]);
	const replyTo = parseAddresses(message.replyToJson);
	const sender = message.fromAddress ? [{ name: message.fromName, address: message.fromAddress }] : [];
	const to: MailAddress[] = [];
	const cc: MailAddress[] = [];
	const seen = new Set<string>();
	const push = (list: MailAddress[], entries: MailAddress[]) => {
		for (const entry of entries) {
			const address = entry.address.toLowerCase();
			if (own.has(address) || seen.has(address)) continue;
			seen.add(address);
			list.push({ name: entry.name ?? null, address });
		}
	};
	if (options.mode !== "forward") {
		push(to, replyTo.length > 0 ? replyTo : sender);
		if (options.mode === "reply_all") {
			push(to, parseAddresses(message.toJson));
			push(cc, parseAddresses(message.ccJson));
		}
		// Answering your own sent message: reply to whoever it was sent to.
		if (to.length === 0) {
			push(to, parseAddresses(message.toJson).filter((a) => !own.has(a.address.toLowerCase())));
		}
	}

	const forwarding = options.mode === "forward";
	const prefix = forwarding ? /^\s*(fw|fwd|doorst)\s*:/i : /^\s*(re|antw|aw)\s*:/i;
	const subject = prefix.test(message.subject)
		? message.subject
		: `${forwarding ? "Fw" : "Re"}: ${message.subject}`;
	const fromLine = message.fromName ? `${message.fromName} <${message.fromAddress ?? ""}>` : (message.fromAddress ?? "");
	return {
		accountId: message.accountId,
		to,
		cc,
		subject,
		quotedText: quoteForReply({
			fromLine,
			sentAt: formatDateTime(message.sentAt ?? message.internalDate),
			text: message.bodyText ?? message.snippet,
		}),
		replyToMessageId: forwarding ? null : message.id,
		clientId: row.clientId ?? null,
	};
}

/* ------------------------------------------------- what the sender needs */

export interface QueuedMessage extends MailOutboxMessage {
	references: string[];
}

/** The oldest queued messages, for the sender. Nothing else reads the queue. */
export async function nextQueued(limit: number, db: Db = getDb()): Promise<QueuedMessage[]> {
	const rows = db
		.select({ outbox: mailOutbox, clientName: clients.name })
		.from(mailOutbox)
		.leftJoin(clients, eq(mailOutbox.clientId, clients.id))
		.where(and(eq(mailOutbox.state, "queued"), isNull(mailOutbox.deletedAt)))
		.orderBy(asc(mailOutbox.queuedAt))
		.limit(limit)
		.all();
	const ids = rows.map((r) => r.outbox.id);
	const attachments = attachmentsFor(db, ids);
	const linked = clientsOf(db, ids);
	return rows.map((r) => ({
		...toRecord(r.outbox, r.clientName, attachments.get(r.outbox.id) ?? [], linked.get(r.outbox.id) ?? []),
		references: parseReferences(r.outbox.referencesJson),
	}));
}

/** Claims a queued message for one attempt. False if something else got there first. */
export function markSending(id: string, db: Db = getDb()): boolean {
	const result = db
		.update(mailOutbox)
		.set({ state: "sending", attempts: sql`${mailOutbox.attempts} + 1`, updatedAt: now() })
		.where(and(eq(mailOutbox.id, id), eq(mailOutbox.state, "queued")))
		.run();
	return Number((result as { changes: number | bigint }).changes) === 1;
}

export function markSent(id: string, db: Db = getDb()): void {
	const stamp = now();
	db.update(mailOutbox)
		.set({ state: "sent", sentAt: stamp, lastError: null, updatedAt: stamp })
		.where(eq(mailOutbox.id, id))
		.run();
}

export function markFailed(id: string, error: string, requeue: boolean, db: Db = getDb()): void {
	const stamp = now();
	db.update(mailOutbox)
		.set({ state: requeue ? "queued" : "failed", lastError: error.slice(0, 1000), updatedAt: stamp })
		.where(eq(mailOutbox.id, id))
		.run();
}

export function markAppended(id: string, error: string | null, db: Db = getDb()): void {
	const stamp = now();
	db.update(mailOutbox)
		.set({
			appendedToSentAt: error ? null : stamp,
			appendError: error ? error.slice(0, 500) : null,
			updatedAt: stamp,
		})
		.where(eq(mailOutbox.id, id))
		.run();
}
