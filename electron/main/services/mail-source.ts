/**
 * What the sync engine needs from a mailbox, and nothing about how IMAP does it.
 *
 * The real implementation is ./mail-imap.ts over imapflow. Tests hand the sync a
 * fake, which is the only way the resume, UIDVALIDITY and deletion logic gets
 * exercised without a server that disagrees with the RFCs on the day the test
 * runs.
 *
 * Every method is read-only. There is no store, no move and no expunge on this
 * interface, so the phase 3 promise is enforced by the type rather than by
 * remembering.
 */
import type { MailAddress, MailSecurity, MailSpecialUse } from "../../shared/types";

export interface MailConnection {
	host: string;
	port: number;
	security: MailSecurity;
	username: string;
	/** Empty for an account that signs in with Microsoft. */
	password: string;
	/**
	 * A Microsoft access token. When set, the connection signs in with
	 * XOAUTH2 instead of the password. Lives in memory only.
	 */
	accessToken?: string;
}

export interface RemoteFolder {
	path: string;
	name: string;
	delimiter: string | null;
	specialUse: MailSpecialUse | null;
}

export interface RemoteMailbox {
	uidValidity: string;
	uidNext: number;
	exists: number;
}

export interface RemoteEnvelope {
	date: string | null;
	subject: string;
	messageId: string | null;
	inReplyTo: string | null;
	references: string[];
	from: MailAddress | null;
	to: MailAddress[];
	cc: MailAddress[];
	replyTo: MailAddress[];
}

export interface RemoteHeader {
	uid: number;
	flags: string[];
	/** UTC ISO-8601. Falls back to the envelope date, then to now. */
	internalDate: string;
	size: number | null;
	envelope: RemoteEnvelope;
	hasAttachments: boolean;
}

export interface RemoteFlags {
	uid: number;
	flags: string[];
}

export interface MailboxSource {
	listFolders(): Promise<RemoteFolder[]>;
	/** Selects the folder read-only. Every UID call after this is against it. */
	openFolder(path: string): Promise<RemoteMailbox>;
	/** UIDs on the server matching either bound. Both given means the union. */
	searchUids(query: { since?: string; uidFrom?: number }): Promise<number[]>;
	fetchHeaders(uids: number[]): Promise<RemoteHeader[]>;
	fetchFlags(uids: number[]): Promise<RemoteFlags[]>;
	/** The raw RFC 822 source, or null when the server no longer has the UID. */
	fetchSource(uid: number, maxBytes: number): Promise<Buffer | null>;
	close(): Promise<void>;
}

/**
 * What imapflow is given to sign in with: the access token for a Microsoft
 * account (XOAUTH2), the password for every other.
 */
export function imapAuth(connection: MailConnection): { user: string; pass: string } | { user: string; accessToken: string } {
	return connection.accessToken
		? { user: connection.username, accessToken: connection.accessToken }
		: { user: connection.username, pass: connection.password };
}

export type MailboxSourceFactory = (connection: MailConnection) => Promise<MailboxSource>;

let factory: MailboxSourceFactory | null = null;

export function configureMailboxSource(next: MailboxSourceFactory): void {
	factory = next;
}

export function openMailbox(connection: MailConnection): Promise<MailboxSource> {
	if (!factory) throw new Error("No mailbox source is configured.");
	return factory(connection);
}

/**
 * Turns an imapflow failure into a sentence with the next action in it. The
 * raw error is kept off the screen: it can contain the server's response text,
 * and a stack trace helps nobody at a settings screen.
 */
export function describeMailError(
	error: unknown,
	connection: { host: string; username: string; accessToken?: string },
): string {
	const e = error as { code?: string; authenticationFailed?: boolean; message?: string };
	// nodemailer reports a refused login as EAUTH, imapflow as authenticationFailed.
	if (connection.accessToken && (e.authenticationFailed || e.code === "EAUTH")) {
		return `${connection.host} refused the Microsoft sign-in for ${connection.username}. If the mailbox is at work, ask whoever runs it to allow IMAP and SMTP for it; otherwise sign in again.`;
	}
	if (e.authenticationFailed || e.code === "EAUTH") {
		return `The password for ${connection.username} was rejected by ${connection.host}. Update it in account settings.`;
	}
	switch (e.code) {
		case "ENOTFOUND":
		case "EAI_AGAIN":
			return `Could not find ${connection.host}. Check the server address in account settings.`;
		case "ECONNREFUSED":
			return `${connection.host} refused the connection. Check the port and security setting.`;
		case "CONNECT_TIMEOUT":
		case "ETIMEOUT":
		case "ETIMEDOUT":
			return `${connection.host} did not answer in time. Check the connection and try again.`;
		case "ERR_TLS_CERT_ALTNAME_INVALID":
		case "CERT_HAS_EXPIRED":
		case "DEPTH_ZERO_SELF_SIGNED_CERT":
		case "SELF_SIGNED_CERT_IN_CHAIN":
		case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
			return `The certificate ${connection.host} presented is not trusted. Juno will not connect to it.`;
		case "NoConnection":
			return `The connection to ${connection.host} was lost. Sync will try again.`;
		default:
			return `Could not sync ${connection.username} at ${connection.host}. ${e.message ?? "The server gave no reason."}`;
	}
}
