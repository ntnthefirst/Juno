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
import type { MailConnection } from "./mail-source";

export interface MailboxWriter {
	/**
	 * Selects a folder for writing. Every uid in a later call is against it.
	 * Returns the mailbox's UIDVALIDITY, which the caller compares against the
	 * one it synced: a folder that has been renumbered has to be resynced
	 * before any uid in it means anything.
	 */
	openFolder(path: string): Promise<{ uidValidity: string }>;

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
