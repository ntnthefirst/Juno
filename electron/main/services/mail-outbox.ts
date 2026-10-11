/**
 * The outbox: drafts, the way a message is queued, and the queue the sender
 * reads.
 *
 * An agent writes drafts and nothing else. A message reaches `queued` through
 * `requestSend`, which only the window calls, when a person presses Send in the
 * editor, and there is no MCP tool that sends, queues or approves one
 * (.claude/rules/mcp.md section 4). The sender in ./mail-send.ts reads `queued`
 * and nothing else. `pending` is a state older versions wrote for a message an
 * agent had asked to send; nothing writes it any more, and such a row opens in
 * the editor like a draft.
 *
 * Decision 9 still holds here: an invoice nudge carries a title and an amount
 * typed by the owner, and Juno never numbers or issues one.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
	MailThreadOutgoing,
	MailReplyInput,
	MailReplyMode,
	MailReplySeed,
	MailTemplateSendInput,
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
import { htmlToText, quoteForReply, quoteHtmlForReply, textToHtml } from "./mail-html";
import { clientsFor } from "./mail-recipients";
import { renderTemplate } from "./mail-templates";

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

/**
 * Fired whenever a row changes outside the sender's own lifecycle: a draft
 * saved or edited, a message cancelled, retried, approved or removed. The
 * sender publishes `sending`, `sent`, `failed` and the Sent-folder append
 * itself in ./mail-send.ts; this covers everything else `mail.outboxChanged`
 * also needs to reach the window for, which used to be nothing, so a draft
 * autosaved in the background never showed up in an open outbox list.
 */
const changeListeners = new Set<(message: MailOutboxMessage) => void>();

export function onChange(listener: (message: MailOutboxMessage) => void): () => void {
	changeListeners.add(listener);
	return () => changeListeners.delete(listener);
}

function notifyChanged(message: MailOutboxMessage): void {
	for (const listener of changeListeners) listener(message);
}

/**
 * Fired when an agent has written a draft, so the window can open it in the
 * editor the way it would open one a person started. Nothing here sends it.
 */
const agentDraftListeners = new Set<(message: MailOutboxMessage) => void>();

export function onAgentDraft(listener: (message: MailOutboxMessage) => void): () => void {
	agentDraftListeners.add(listener);
	return () => agentDraftListeners.delete(listener);
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
 * What was sent from Juno into a thread and has not arrived in it as a synced
 * message yet, oldest first. The Sent folder only reaches the reader on the
 * next sync, and until then the outbox is the only record of the reply.
 *
 * A row belongs to the thread when it was created as a reply to one of its
 * messages (`thread_id`), or when its In-Reply-To or References point at one of
 * them, which covers a row whose thread link was lost with the message it
 * answered. Once a live message in the thread carries the row's Message-ID the
 * synced copy is the record and the row steps aside, so nothing shows twice.
 * Drafts, rows waiting for approval and failed sends are listed, marked by
 * their state, so the overview shows the whole conversation. A cancelled row is
 * not in it any more, and a deleted row never is.
 */
export function outgoingForThread(threadId: string, db: Db = getDb()): MailThreadOutgoing[] {
	const synced = db
		.select({ messageId: mailMessages.messageId })
		.from(mailMessages)
		.where(and(eq(mailMessages.threadId, threadId), isNull(mailMessages.deletedAt)))
		.all();
	const messageIds = [...new Set(synced.map((m) => m.messageId).filter((v): v is string => Boolean(v)))];

	const belongs = [eq(mailOutbox.threadId, threadId)];
	if (messageIds.length > 0) {
		belongs.push(inArray(mailOutbox.inReplyTo, messageIds));
		belongs.push(
			sql`exists (select 1 from json_each(${mailOutbox.referencesJson}) where json_each.value in (${sql.join(
				messageIds.map((id) => sql`${id}`),
				sql`, `,
			)}))`,
		);
	}
	const rows = db
		.select({ outbox: mailOutbox, fromName: mailAccounts.fromName, fromAddress: mailAccounts.email })
		.from(mailOutbox)
		.innerJoin(mailAccounts, eq(mailOutbox.accountId, mailAccounts.id))
		.where(
			and(
				isNull(mailOutbox.deletedAt),
				inArray(mailOutbox.state, ["draft", "pending", "queued", "sending", "sent", "failed"]),
				or(...belongs),
			),
		)
		.all()
		.filter((r) => !messageIds.includes(r.outbox.messageId));
	if (rows.length === 0) return [];

	const attachments = attachmentsFor(
		db,
		rows.map((r) => r.outbox.id),
	);
	return rows
		.map((r): MailThreadOutgoing => {
			const row = r.outbox;
			return {
				id: row.id,
				accountId: row.accountId,
				state: row.state as MailThreadOutgoing["state"],
				from: { name: r.fromName, address: r.fromAddress },
				to: parseAddresses(row.toJson),
				cc: parseAddresses(row.ccJson),
				subject: row.subject,
				bodyText: row.bodyText,
				bodyHtml: row.bodyHtml,
				messageId: row.messageId,
				inReplyTo: row.inReplyTo,
				date: row.sentAt ?? row.queuedAt ?? row.createdAt,
				attachments: attachments.get(row.id) ?? [],
			};
		})
		.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
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
		// Bare paragraphs, the same as what the editor produces for a mail somebody
		// types. The house card, accent line and footer belong to templates: a plain
		// mail from an agent must not look different from one written by hand.
		bodyHtml: textToHtml(input.bodyText),
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

/**
 * A plain draft. A template is never saved as one: it is filled and sent in one
 * step by sendFromTemplate, so a draft that names a template is refused here
 * for the window and for an agent alike.
 */
export async function createDraft(input: MailDraftInput, db: Db = getDb()): Promise<MailOutboxMessage> {
	if (input.templateId) {
		throw new Error("A template cannot be saved as a draft. Fill it and send it in one step instead.");
	}
	return insertDraft(input, db);
}

async function insertDraft(input: MailDraftInput, db: Db): Promise<MailOutboxMessage> {
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
				requestedBy: input.actor ?? "user",
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
	const record = await requireRecord(id, db);
	notifyChanged(record);
	if (input.actor === "agent") for (const listener of agentDraftListeners) listener(record);
	return record;
}

/**
 * Answers or forwards a received message from the new text alone. It does what
 * the window does on Reply (replySeed, then a draft with the quote under the
 * typed text) so an agent and a person end up with the same message. It stays a
 * draft: sending it is a separate, confirmed step.
 */
export async function createReply(input: MailReplyInput, db: Db = getDb()): Promise<MailOutboxMessage> {
	const text = input.bodyText.trim();
	if (!text) throw new Error("A reply needs some text. Write what you want to say above the quoted message.");
	const mode = input.mode ?? "reply";
	const seed = await replySeed(input.messageId, { mode }, db);
	const to = input.to ?? seed.to;
	if (to.length === 0) {
		throw new Error(
			mode === "forward"
				? "A forward needs a recipient. Pass to with the address it goes to."
				: "This message has no address to answer. Pass to with the address it goes to.",
		);
	}
	const quote = input.includeQuote !== false;
	return insertDraft(
		{
			accountId: seed.accountId,
			to,
			cc: input.cc ?? seed.cc,
			...(input.bcc ? { bcc: input.bcc } : {}),
			subject: seed.subject,
			bodyText: quote ? `${text}\n\n${seed.quotedText}` : text,
			bodyHtml: `${textToHtml(text)}${quote ? seed.quotedHtml : ""}`,
			replyToMessageId: seed.replyToMessageId,
			clientId: seed.clientId,
			documentIds: input.documentIds ?? [],
			...(input.actor ? { actor: input.actor } : {}),
		},
		db,
	);
}

/**
 * What a template makes of the values typed for it, as the draft input it
 * would be sent from. The client and project file the message and fill in
 * nothing. A template starts a new message; it is never a reply.
 */
async function draftOf(input: MailTemplateSendInput, db: Db): Promise<MailDraftInput> {
	const rendered = await renderTemplate(
		{
			templateId: input.templateId,
			...(input.extras ? { extras: input.extras } : {}),
		},
		db,
	);
	return {
		accountId: input.accountId,
		to: input.to,
		...(input.cc ? { cc: input.cc } : {}),
		...(input.bcc ? { bcc: input.bcc } : {}),
		subject: rendered.subject,
		bodyText: rendered.bodyText,
		bodyHtml: rendered.bodyHtml,
		clientId: input.clientId ?? null,
		projectId: input.projectId ?? null,
		documentIds: input.documentIds ?? [],
	};
}

/**
 * Fills a template and queues it, as one operation, for a person who pressed
 * the button for it. Nothing of it is kept as a draft, so when the send is
 * refused (a recipient missing, a placeholder with no value) the row made along
 * the way is removed again.
 */
export async function sendFromTemplate(input: MailTemplateSendInput, db: Db = getDb()): Promise<MailOutboxMessage> {
	const made = await insertDraft({ ...(await draftOf(input, db)), templateId: input.templateId }, db);
	try {
		return await requestSend(made.id, db);
	} catch (cause) {
		await remove(made.id, db);
		throw cause;
	}
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
	const record = await requireRecord(id, db);
	notifyChanged(record);
	return record;
}

/** The marker the template renderer leaves where a value was missing. */
const MISSING_MARKER = /\[ontbreekt: ([\w.]+)\]/g;

/** Documents attached to a message that has not gone out. */
function attachmentCount(db: Db, outboxId: string): number {
	return db
		.select({ id: mailOutboxAttachments.id })
		.from(mailOutboxAttachments)
		.where(and(eq(mailOutboxAttachments.outboxId, outboxId), isNull(mailOutboxAttachments.deletedAt)))
		.all().length;
}

function validateSendable(row: Row, account: typeof mailAccounts.$inferSelect, attachments: number): void {
	if (parseAddresses(row.toJson).length === 0) throw new Error("The message has nobody in To.");
	if (!row.subject.trim()) throw new Error("The message has no subject.");
	// A document sent on its own is a message: the body may be empty when there is
	// something attached to carry it.
	if (!row.bodyText.trim() && !row.bodyHtml && attachments === 0) throw new Error("The message is empty.");
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

/** What an agent's request to send is shown as, in the Agent tab: the message as it would go out. */
export interface SendReview {
	summary: string;
	preview: string;
	/** What the preview was built from, checked again when a person approves. */
	seal: string;
}

const PREVIEW_BODY_MAX = 6000;

function describeAddresses(list: MailAddress[]): string {
	return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

function messagePreview(parts: {
	from: string;
	to: MailAddress[];
	cc: MailAddress[];
	bcc: MailAddress[];
	subject: string;
	attachments: string[];
	bodyText: string;
}): string {
	const lines = [`From: ${parts.from}`, `To: ${describeAddresses(parts.to)}`];
	if (parts.cc.length > 0) lines.push(`Cc: ${describeAddresses(parts.cc)}`);
	if (parts.bcc.length > 0) lines.push(`Bcc: ${describeAddresses(parts.bcc)}`);
	lines.push(`Subject: ${parts.subject}`);
	if (parts.attachments.length > 0) lines.push(`Attached: ${parts.attachments.join(", ")}`);
	const body = parts.bodyText.trim();
	lines.push("", body.length > PREVIEW_BODY_MAX ? `${body.slice(0, PREVIEW_BODY_MAX)}\n[cut here, the message is longer]` : body);
	return lines.join("\n");
}

function summaryOf(subject: string, to: MailAddress[]): string {
	const first = to[0];
	const who = first ? (first.name ?? first.address) : "nobody";
	return `Send "${subject}" to ${who}${to.length > 1 ? ` and ${to.length - 1} more` : ""}`;
}

/**
 * What a person reads before approving an agent's request to send this draft,
 * and the refusal when it could not be sent anyway. The seal is the draft's
 * last change: if it moves before they approve, the request is refused,
 * because the text they read is not the text that would go.
 */
export async function reviewForSend(id: string, db: Db = getDb()): Promise<SendReview> {
	const row = requireRow(id, db);
	if (row.state !== "draft" && row.state !== "failed" && row.state !== "pending") {
		throw new Error(`A ${row.state} message cannot be sent again.`);
	}
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, row.accountId)).get();
	if (!account || account.deletedAt) throw new Error("The account this message belongs to no longer exists.");
	validateSendable(row, account, attachmentCount(db, row.id));
	const record = await requireRecord(id, db);
	return {
		summary: summaryOf(record.subject, record.to),
		preview: messagePreview({
			from: account.fromName ? `${account.fromName} <${account.email}>` : account.email,
			to: record.to,
			cc: record.cc,
			bcc: record.bcc,
			subject: record.subject,
			attachments: record.attachments.map((a) => a.filename),
			bodyText: record.bodyText,
		}),
		seal: row.updatedAt,
	};
}

/** Refuses an approval of a draft that has been edited since it was asked for. */
export async function verifyDraftUnchanged(id: string, seal: string | null, db: Db = getDb()): Promise<void> {
	const row = requireRow(id, db);
	if (seal === null || row.updatedAt !== seal) {
		throw new Error("The draft was changed after it was asked for, so what was approved is not what would go. Ask again.");
	}
}

function templateSeal(subject: string, bodyHtml: string): string {
	return createHash("sha256").update(subject).update("\n").update(bodyHtml).digest("hex");
}

/**
 * The same for a template: the message the template makes right now, from
 * these values, which is what is sent if it is approved. Nothing is
 * written; a template is never kept as a draft.
 */
export async function reviewTemplateSend(input: MailTemplateSendInput, db: Db = getDb()): Promise<SendReview> {
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, input.accountId)).get();
	if (!account || account.deletedAt) throw new Error("That mail account does not exist.");
	const to = cleanAddresses(input.to, "To");
	const cc = cleanAddresses(input.cc, "Cc");
	const bcc = cleanAddresses(input.bcc, "Bcc");
	if (to.length === 0) throw new Error("The message has nobody in To.");
	if (!account.smtpHost) throw new Error(`${account.email} has no outgoing server. Add one in account settings.`);

	const rendered = await renderTemplate(
		{
			templateId: input.templateId,
			...(input.extras ? { extras: input.extras } : {}),
		},
		db,
	);
	if (rendered.missing.length > 0) {
		throw new Error(
			`The template still has a placeholder without a value: ${rendered.missing.join(", ")}. Pass a value for each in extras, by input key.`,
		);
	}
	const attachments: string[] = [];
	for (const documentId of new Set(input.documentIds ?? [])) {
		const document = db
			.select({ title: documents.title })
			.from(documents)
			.where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
			.get();
		if (!document) throw new Error("One of the documents to attach does not exist.");
		attachments.push(`${document.title}.pdf`);
	}
	return {
		summary: summaryOf(rendered.subject, to),
		preview: messagePreview({
			from: account.fromName ? `${account.fromName} <${account.email}>` : account.email,
			to,
			cc,
			bcc,
			subject: rendered.subject,
			attachments,
			bodyText: rendered.bodyText,
		}),
		seal: templateSeal(rendered.subject, rendered.bodyHtml),
	};
}

/** Refuses an approval when the template changed what it would say. */
export async function verifyTemplateUnchanged(
	input: MailTemplateSendInput,
	seal: string | null,
	db: Db = getDb(),
): Promise<void> {
	const rendered = await renderTemplate(
		{
			templateId: input.templateId,
			...(input.extras ? { extras: input.extras } : {}),
		},
		db,
	);
	if (seal === null || templateSeal(rendered.subject, rendered.bodyHtml) !== seal) {
		throw new Error("The template now says something different from what was approved. Ask again.");
	}
}

/**
 * Queues a message for sending. Only the window calls this, when a person
 * presses Send, so the press is the confirmation and there is nothing for an
 * agent to ask for: it has no route here.
 */
export async function requestSend(id: string, db: Db = getDb()): Promise<MailOutboxMessage> {
	const row = requireRow(id, db);
	if (row.state !== "draft" && row.state !== "failed" && row.state !== "pending") {
		throw new Error(`A ${row.state} message cannot be sent again.`);
	}
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, row.accountId)).get();
	if (!account || account.deletedAt) throw new Error("The account this message belongs to no longer exists.");
	validateSendable(row, account, attachmentCount(db, row.id));

	const stamp = now();
	db.update(mailOutbox)
		.set({ state: "queued", requestedBy: "user", approvedAt: stamp, queuedAt: stamp, lastError: null, updatedAt: stamp })
		.where(eq(mailOutbox.id, id))
		.run();
	notifyQueued();
	const record = await requireRecord(id, db);
	notifyChanged(record);
	return record;
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
	const record = await requireRecord(id, db);
	notifyChanged(record);
	return record;
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
	const record = await requireRecord(id, db);
	notifyChanged(record);
	return record;
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
	const record = toRecord({ ...row, deletedAt: stamp }, null, [], []);
	notifyChanged(record);
	return record;
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
		quotedHtml: quoteHtmlForReply({
			fromLine,
			sentAt: formatDateTime(message.sentAt ?? message.internalDate),
			text: message.bodyText ?? message.snippet,
		}),
		replyToMessageId: forwarding ? null : message.id,
		clientId: row.clientId ?? null,
	};
}

/**
 * The same seed for answering or forwarding something Juno sent that has not
 * come back from the Sent folder yet, so it is an outbox row and not a mail
 * message. An answer goes to whoever it was sent to, since answering yourself
 * means carrying on with them, and it threads under the message the sent one
 * answered, because that is the only synced message it has.
 */
export async function replySeedForOutgoing(
	outboxId: string,
	options: { mode: MailReplyMode },
	db: Db = getDb(),
): Promise<MailReplySeed> {
	const row = db
		.select()
		.from(mailOutbox)
		.where(and(eq(mailOutbox.id, outboxId), isNull(mailOutbox.deletedAt)))
		.get();
	if (!row) throw new Error("That message does not exist.");
	if (row.state !== "queued" && row.state !== "sending" && row.state !== "sent") {
		throw new Error("Only a message that has been sent can be answered or forwarded. Open a draft to edit it.");
	}
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, row.accountId)).get();
	if (!account) throw new Error("The account this message belongs to no longer exists.");

	const own = new Set([account.email.toLowerCase(), account.username.toLowerCase()]);
	const forwarding = options.mode === "forward";
	const to: MailAddress[] = [];
	const cc: MailAddress[] = [];
	if (!forwarding) {
		const seen = new Set<string>();
		const push = (list: MailAddress[], entries: MailAddress[]) => {
			for (const entry of entries) {
				const address = entry.address.toLowerCase();
				if (own.has(address) || seen.has(address)) continue;
				seen.add(address);
				list.push({ name: entry.name ?? null, address });
			}
		};
		push(to, parseAddresses(row.toJson));
		if (options.mode === "reply_all") push(cc, parseAddresses(row.ccJson));
	}

	const prefix = forwarding ? /^\s*(fw|fwd|doorst)\s*:/i : /^\s*(re|antw|aw)\s*:/i;
	const subject = prefix.test(row.subject) ? row.subject : `${forwarding ? "Fw" : "Re"}: ${row.subject}`;
	return {
		accountId: row.accountId,
		to,
		cc,
		subject,
		quotedText: quoteForReply({
			fromLine: account.fromName ? `${account.fromName} <${account.email}>` : account.email,
			sentAt: formatDateTime(row.sentAt ?? row.queuedAt ?? row.createdAt),
			text: row.bodyText,
		}),
		quotedHtml: quoteHtmlForReply({
			fromLine: account.fromName ? `${account.fromName} <${account.email}>` : account.email,
			sentAt: formatDateTime(row.sentAt ?? row.queuedAt ?? row.createdAt),
			text: row.bodyText,
		}),
		replyToMessageId: forwarding ? null : row.replyToMessageId,
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
