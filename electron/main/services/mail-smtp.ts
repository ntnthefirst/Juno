/**
 * The mail transport over nodemailer, and the Sent-folder append over imapflow.
 * The only file that speaks SMTP.
 *
 * The message is built once with MailComposer into the exact bytes that go on
 * the wire, and those same bytes are what lands in the Sent folder. Building
 * twice would produce two messages that differ in their boundaries and dates
 * and look, to a phone, like two messages.
 *
 * The same two rules as mail-imap.ts: no logger, because nodemailer at debug
 * level prints the auth exchange, and every connection closed on every path.
 */
import { ImapFlow } from "imapflow";
import { createTransport, type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { MailAddress } from "../../shared/types";
import type { MailTransport, OutgoingMessage, SentAppender, SmtpConnection } from "./mail-transport";

const CONNECT_TIMEOUT_MS = 30_000;

function formatAddress(address: MailAddress): string {
	// nodemailer quotes and encodes the name itself when handed the object form.
	return address.name ? `"${address.name.replace(/"/g, "'")}" <${address.address}>` : address.address;
}

function transportFor(connection: SmtpConnection): Transporter<SMTPTransport.SentMessageInfo> {
	return createTransport({
		host: connection.host,
		port: connection.port,
		secure: connection.security === "tls",
		// starttls means upgrade or fail. A password never travels in the clear.
		requireTLS: connection.security === "starttls",
		auth: { user: connection.username, pass: connection.password },
		connectionTimeout: CONNECT_TIMEOUT_MS,
		greetingTimeout: CONNECT_TIMEOUT_MS,
		logger: false,
		name: "juno.local",
	});
}

/** The message as bytes, and the envelope the server is told. Exported for the tests. */
export async function composeMessage(
	message: OutgoingMessage,
): Promise<{ raw: Buffer; envelope: { from: string; to: string[] } }> {
	const composer = new MailComposer({
		messageId: message.messageId,
		from: formatAddress(message.from),
		to: message.to.map(formatAddress),
		cc: message.cc.map(formatAddress),
		bcc: message.bcc.map(formatAddress),
		subject: message.subject,
		text: message.text,
		...(message.html ? { html: message.html } : {}),
		...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
		...(message.references.length > 0 ? { references: message.references.join(" ") } : {}),
		attachments: message.attachments.map((a) => ({
			filename: a.filename,
			path: a.path,
			contentType: a.contentType,
		})),
		// Juno never asks for a receipt, and never will. Read receipts are out
		// of scope.
		headers: { "X-Mailer": "Juno" },
	});
	const node = composer.compile();
	const envelope = node.getEnvelope();
	const raw = await node.build();
	return {
		raw,
		envelope: { from: envelope.from || message.from.address, to: envelope.to ?? [] },
	};
}

export const smtpTransport: MailTransport = {
	async verify(connection) {
		const transport = transportFor(connection);
		try {
			await transport.verify();
		} finally {
			transport.close();
		}
	},

	async send(connection, message) {
		const { raw, envelope } = await composeMessage(message);
		const transport = transportFor(connection);
		try {
			// The composed bytes go out as they are; the envelope tells the server
			// who they are for, since a raw message is not parsed for that.
			const info = await transport.sendMail({ raw, envelope });
			return {
				raw,
				accepted: (info.accepted ?? []).map(String),
				rejected: (info.rejected ?? []).map(String),
			};
		} finally {
			transport.close();
		}
	},
};

/**
 * Copies the sent bytes into the account's Sent folder with the Seen flag, so
 * the phone shows the message as sent rather than as new mail.
 */
export const imapSentAppender: SentAppender = async (connection, folderPath, raw, sentAt) => {
	const client = new ImapFlow({
		host: connection.host,
		port: connection.port,
		secure: connection.security === "tls",
		auth: { user: connection.username, pass: connection.password },
		logger: false,
		disableAutoIdle: true,
		connectionTimeout: CONNECT_TIMEOUT_MS,
		clientInfo: { name: "Juno" },
	});
	try {
		await client.connect();
		if (!client.secureConnection) {
			throw new Error(`${connection.host} did not offer an encrypted connection.`);
		}
		await client.append(folderPath, raw, ["\\Seen"], new Date(sentAt));
	} finally {
		await client.logout().catch(() => client.close());
	}
};
