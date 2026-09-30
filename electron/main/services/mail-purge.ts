/**
 * Purging the mail of a removed account.
 *
 * Removing an account forgets its password and soft-deletes the row, and its
 * mail stays. This is the other half: a confirmed, permanent delete of
 * everything stored for it. It is the one place in the mail domain that hard
 * deletes (.claude/rules/data.md section 6), and it is deliberately not an MCP
 * tool. An agent may remove an account, which is reversible in effect; it may
 * not decide that the mail is gone for good.
 */
import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { and, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { MailPurgeResult, RemovedMailAccount } from "../../shared/types";
import { getDb, type Db } from "../db";
import {
	mailAccounts,
	mailAttachments,
	mailFolders,
	mailMessages,
	mailOutbox,
	mailOutboxAttachments,
	mailOutboxClients,
	mailThreads,
} from "../db/schema";
import { mailRoot } from "./mail-threads";

export type MailPurgeErrorCode = "not-found" | "not-removed" | "confirmation-mismatch";

/** Typed, because the window and the tests both need to tell the refusals apart. */
export class MailPurgeError extends Error {
	readonly code: MailPurgeErrorCode;

	constructor(code: MailPurgeErrorCode, message: string) {
		super(message);
		this.name = "MailPurgeError";
		this.code = code;
	}
}

/**
 * The removed accounts that still hold mail, newest removal first.
 *
 * "Holds mail" means at least one message or one composed message. An account
 * that only ever listed its folders has nothing worth a button, and its empty
 * shell rows are swept the day a purge is asked for by id.
 */
export function removedAccounts(db: Db = getDb()): RemovedMailAccount[] {
	const removed = db
		.select()
		.from(mailAccounts)
		.where(isNotNull(mailAccounts.deletedAt))
		.orderBy(desc(mailAccounts.deletedAt), desc(mailAccounts.id))
		.all();

	const out: RemovedMailAccount[] = [];
	for (const account of removed) {
		const messages = db
			.select({ n: count() })
			.from(mailMessages)
			.where(eq(mailMessages.accountId, account.id))
			.get()?.n ?? 0;
		const outboxMessages = db
			.select({ n: count() })
			.from(mailOutbox)
			.where(eq(mailOutbox.accountId, account.id))
			.get()?.n ?? 0;
		if (messages === 0 && outboxMessages === 0) continue;

		const attachments = db
			.select({ n: count(), bytes: sql<number>`coalesce(sum(${mailAttachments.size}), 0)` })
			.from(mailAttachments)
			.innerJoin(mailMessages, eq(mailMessages.id, mailAttachments.messageId))
			.where(eq(mailMessages.accountId, account.id))
			.get();

		out.push({
			id: account.id,
			label: account.label,
			email: account.email,
			removedAt: account.deletedAt ?? account.updatedAt,
			messages,
			attachments: attachments?.n ?? 0,
			outboxMessages,
			attachmentBytes: Number(attachments?.bytes ?? 0),
		});
	}
	return out;
}

/**
 * Deletes everything stored for a removed account, for good.
 *
 * Refuses unless the account is removed and `confirmEmail` is its address,
 * compared without regard to case. The rows go in one transaction, children
 * before parents because foreign keys are on; the files go afterwards, so a
 * rolled back transaction never leaves a database pointing at deleted files.
 *
 * The account row itself stays, soft-deleted. Audit events, past agent
 * requests and anything else that names the account by id keep resolving to
 * a name and an address, and nothing else in the schema needs the row gone.
 *
 * Safe to run twice: the second run finds no rows and no files, and says so
 * with zeros rather than an error.
 */
export function purge(id: string, confirmEmail: string, db: Db = getDb()): MailPurgeResult {
	const account = db.select().from(mailAccounts).where(eq(mailAccounts.id, id)).get();
	if (!account) throw new MailPurgeError("not-found", "That mail account does not exist.");
	if (account.deletedAt === null) {
		throw new MailPurgeError(
			"not-removed",
			`${account.email} is still connected. Remove the account first, then delete its stored mail.`,
		);
	}
	if (confirmEmail.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
		throw new MailPurgeError(
			"confirmation-mismatch",
			`The address does not match. Enter ${account.email} to confirm.`,
		);
	}

	const root = resolve(mailRoot());

	const { result, filePaths } = db.transaction((tx) => {
		const accountMessages = tx
			.select({ id: mailMessages.id })
			.from(mailMessages)
			.where(eq(mailMessages.accountId, id));
		const accountThreads = tx
			.select({ id: mailThreads.id })
			.from(mailThreads)
			.where(eq(mailThreads.accountId, id));
		const accountOutbox = tx
			.select({ id: mailOutbox.id })
			.from(mailOutbox)
			.where(eq(mailOutbox.accountId, id));

		// Counted first: the driver does not report how many rows a delete removed.
		const messageCount = tx.select({ n: count() }).from(mailMessages).where(eq(mailMessages.accountId, id)).get()?.n ?? 0;
		const outboxCount = tx.select({ n: count() }).from(mailOutbox).where(eq(mailOutbox.accountId, id)).get()?.n ?? 0;
		const attachmentCount =
			tx
				.select({ n: count() })
				.from(mailAttachments)
				.where(inArray(mailAttachments.messageId, accountMessages))
				.get()?.n ?? 0;

		const paths = tx
			.select({ filePath: mailAttachments.filePath })
			.from(mailAttachments)
			.where(inArray(mailAttachments.messageId, accountMessages))
			.all()
			.map((row) => row.filePath);

		// A composed message on another account can answer a message here. The
		// link is a convenience, so it is cut rather than left to fail the delete.
		tx.update(mailOutbox)
			.set({ replyToMessageId: null })
			.where(and(ne(mailOutbox.accountId, id), inArray(mailOutbox.replyToMessageId, accountMessages)))
			.run();
		tx.update(mailOutbox)
			.set({ threadId: null })
			.where(and(ne(mailOutbox.accountId, id), inArray(mailOutbox.threadId, accountThreads)))
			.run();

		tx.delete(mailOutboxClients).where(inArray(mailOutboxClients.outboxId, accountOutbox)).run();
		tx.delete(mailOutboxAttachments).where(inArray(mailOutboxAttachments.outboxId, accountOutbox)).run();
		tx.delete(mailOutbox).where(eq(mailOutbox.accountId, id)).run();

		tx.delete(mailAttachments).where(inArray(mailAttachments.messageId, accountMessages)).run();
		// The search index has no foreign key. A trigger on this table removes
		// each message's row from it, so nothing stays searchable.
		tx.delete(mailMessages).where(eq(mailMessages.accountId, id)).run();
		tx.delete(mailThreads).where(eq(mailThreads.accountId, id)).run();
		tx.delete(mailFolders).where(eq(mailFolders.accountId, id)).run();

		return {
			result: { messages: messageCount, attachments: attachmentCount, outboxMessages: outboxCount },
			filePaths: paths,
		};
	});

	let leftOnDisk = 0;
	for (const path of filePaths) {
		const target = insideRoot(root, path);
		if (!target) {
			// A stored path that leaves the mail folder is never followed.
			leftOnDisk += 1;
			continue;
		}
		if (!removeQuietly(target, false)) leftOnDisk += 1;
	}
	// Bodies are in the database and attachments sit in a folder per message
	// under a folder per account, so what remains is that account's folder.
	const accountFolder = insideRoot(root, id);
	if (accountFolder && !removeQuietly(accountFolder, true)) leftOnDisk += 1;

	return { ...result, leftOnDisk };
}

/**
 * The absolute path when it lies strictly inside the root, otherwise null.
 * Stored paths are built from ids, but a database that was moved or edited is
 * not impossible, and this function deletes.
 */
function insideRoot(root: string, relative: string): string | null {
	const target = resolve(root, relative);
	return target.startsWith(root + sep) ? target : null;
}

/** True when the path is gone afterwards. A path that was never there counts. */
function removeQuietly(target: string, recursive: boolean): boolean {
	try {
		rmSync(target, { recursive, force: true });
		return true;
	} catch {
		return false;
	}
}
