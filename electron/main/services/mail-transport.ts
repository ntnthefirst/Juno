/**
 * What the outbox needs from SMTP and from the Sent folder, and nothing about
 * how nodemailer or imapflow do it.
 *
 * The real implementations are in ./mail-smtp.ts. Tests hand the sender a fake,
 * which is how the queue, the retry and the append are proven without a mail
 * server accepting test messages on a schedule.
 */
import type { MailAddress, MailSecurity } from "../../shared/types";

export interface SmtpConnection {
	host: string;
	port: number;
	security: MailSecurity;
	username: string;
	password: string;
	fromAddress: string;
	fromName: string | null;
}

export interface OutgoingAttachment {
	filename: string;
	path: string;
	contentType: string;
}

export interface OutgoingMessage {
	messageId: string;
	from: MailAddress;
	to: MailAddress[];
	cc: MailAddress[];
	bcc: MailAddress[];
	subject: string;
	text: string;
	html: string | null;
	inReplyTo: string | null;
	references: string[];
	attachments: OutgoingAttachment[];
}

export interface SendResult {
	/** The RFC 822 bytes as sent, for the Sent folder. */
	raw: Buffer;
	/** Addresses the server accepted and refused, when it says. */
	accepted: string[];
	rejected: string[];
}

export interface MailTransport {
	/** Connects and authenticates, then disconnects. Throws on failure. */
	verify(connection: SmtpConnection): Promise<void>;
	send(connection: SmtpConnection, message: OutgoingMessage): Promise<SendResult>;
}

/**
 * Copies a sent message into a folder on the IMAP server. The one write phase
 * 4 makes to IMAP, kept apart from the read-only source interface on purpose.
 */
export type SentAppender = (
	connection: { host: string; port: number; security: MailSecurity; username: string; password: string },
	folderPath: string,
	raw: Buffer,
	sentAt: string,
) => Promise<void>;

let transport: MailTransport | null = null;
let appender: SentAppender | null = null;

export function configureMailTransport(next: MailTransport, appendToSent: SentAppender): void {
	transport = next;
	appender = appendToSent;
}

function requireTransport(): MailTransport {
	if (!transport) throw new Error("No mail transport is configured.");
	return transport;
}

export function verifyTransport(connection: SmtpConnection): Promise<void> {
	return requireTransport().verify(connection);
}

export function sendMessage(connection: SmtpConnection, message: OutgoingMessage): Promise<SendResult> {
	return requireTransport().send(connection, message);
}

export function appendToSent(
	connection: { host: string; port: number; security: MailSecurity; username: string; password: string },
	folderPath: string,
	raw: Buffer,
	sentAt: string,
): Promise<void> {
	if (!appender) throw new Error("No Sent folder appender is configured.");
	return appender(connection, folderPath, raw, sentAt);
}
