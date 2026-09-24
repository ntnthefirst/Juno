/**
 * What filing mail needs from a mailbox, and nothing about how IMAP does it.
 *
 * This interface is separate from `MailboxSource` on purpose, and the split is
 * load-bearing rather than tidy. Sync is read-only by construction: the type it
 * is handed has no method that writes, so a bug in the sync engine cannot
 * become a change to somebody's mailbox. Filing a message is a different act,
 * asked for by a person or approved by one, and it gets a different object.
 *
 * The same reasoning put the Sent copy on its own appender in
 * ./mail-transport.ts. Three interfaces over one protocol is not duplication,
 * it is three different permissions.
 *
 * The real implementation is ./mail-imap-write.ts over imapflow. Tests hand the
 * service a fake, which is how the folder resolution, the UID remap and the
 * refusal to expunge without a request get exercised without a server.
 */
import type { Db } from "../db";
import { connectionFor } from "./mail-accounts";
import { describeMailError, type MailConnection } from "./mail-source";

export interface MailboxWriter {
	/**
	 * Selects a folder for writing. Every uid in a later call is against it.
	 * Returns the mailbox's UIDVALIDITY, which the caller compares against the
	 * one it synced: a folder that has been renumbered has to be resynced
	 * before any uid in it means anything.
	 */
	openFolder(path: string): Promise<{ uidValidity: string }>;

	/**
	 * Creates a mailbox at `path`. The delimiter in the path is the server's, so
	 * the caller builds it from the parent folder's own delimiter rather than
	 * assuming one. A path the server already has is not an error: the caller
	 * wanted a folder there and there is one.
	 */
	createFolder(path: string): Promise<void>;

	/** Renames, and therefore moves, a mailbox. Its children come with it. */
	renameFolder(path: string, toPath: string): Promise<void>;

	/**
	 * Removes a mailbox from the server, with every message in it. Destroys
	 * things, so the only caller is a service function a person has confirmed.
	 */
	deleteFolder(path: string): Promise<void>;

	/** Adds and removes flags on uids in the open folder. */
	setFlags(uids: number[], add: string[], remove: string[]): Promise<void>;

	/**
	 * Moves uids out of the open folder into `toPath`.
	 *
	 * The returned map is the server's answer to "where did they land", which
	 * only a server with UIDPLUS gives. An empty map is normal and not a
	 * failure: the caller then forgets the local rows and lets the next sync of
	 * the destination find them again.
	 */
	move(uids: number[], toPath: string): Promise<Map<number, number>>;

	/**
	 * Flags uids \Deleted in the open folder and expunges them. This is the one
	 * call here that destroys something, and the only caller is a service
	 * function a person has confirmed.
	 */
	expunge(uids: number[]): Promise<void>;

	close(): Promise<void>;
}

export type MailboxWriterFactory = (connection: MailConnection) => Promise<MailboxWriter>;

let factory: MailboxWriterFactory | null = null;

export function configureMailboxWriter(next: MailboxWriterFactory): void {
	factory = next;
}

export function openMailboxWriter(connection: MailConnection): Promise<MailboxWriter> {
	if (!factory) throw new Error("No mailbox writer is configured.");
	return factory(connection);
}

/**
 * Opens a writer for an account, runs the work, and logs out in a `finally`
 * whatever happened. A leaked connection is an account locked out for minutes,
 * because providers cap concurrent connections in the low single digits.
 *
 * The connection details are resolved outside the try, because a missing
 * password already reads as a sentence with the next action in it and must not
 * be rewritten as a server failure.
 */
export async function withWriter<T>(
	accountId: string,
	db: Db,
	work: (writer: MailboxWriter) => Promise<T>,
): Promise<T> {
	const connection = connectionFor(accountId, db);
	let writer: MailboxWriter | null = null;
	try {
		writer = await openMailboxWriter(connection);
		return await work(writer);
	} catch (error) {
		throw new Error(describeMailError(error, connection));
	} finally {
		await writer?.close().catch(() => undefined);
	}
}
