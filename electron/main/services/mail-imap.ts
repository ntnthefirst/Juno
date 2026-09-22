/**
 * The mailbox source over imapflow. The only file that speaks IMAP.
 *
 * Two rules from .claude/rules/security.md and verify.md are kept here:
 * - The logger is off. imapflow at debug level logs the auth exchange, and a
 *   log line with a password in it ships to the user's machine.
 * - Every connection is logged out in a `finally`, including on the error
 *   path. Providers cap concurrent connections in the low single digits, and a
 *   sync that leaks three of them locks the account out for minutes.
 *
 * Nothing here writes. There is no STORE, no COPY, no EXPUNGE, and the mailbox
 * is opened read-only so a bug cannot become one.
 */
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import type { MailAddress, MailSpecialUse } from "../../shared/types";
import type {
	MailConnection,
	MailboxSource,
	RemoteEnvelope,
	RemoteFlags,
	RemoteFolder,
	RemoteHeader,
	RemoteMailbox,
} from "./mail-source";

/** UIDs per FETCH, so a command line stays short and a failure loses little. */
const CHUNK = 250;

const CONNECT_TIMEOUT_MS = 30_000;

const SPECIAL_USE: Record<string, MailSpecialUse> = {
	"\\Inbox": "inbox",
	"\\Sent": "sent",
	"\\Drafts": "drafts",
	"\\Trash": "trash",
	"\\Junk": "junk",
	"\\Archive": "archive",
	"\\All": "archive",
};

function chunk<T>(items: T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
	return out;
}

function address(value: { name?: string; address?: string } | undefined): MailAddress | null {
	if (!value?.address) return null;
	return { name: value.name?.trim() || null, address: value.address.trim().toLowerCase() };
}

function addresses(values: { name?: string; address?: string }[] | undefined): MailAddress[] {
	return (values ?? []).map(address).filter((a): a is MailAddress => a !== null);
}

function isoOf(value: Date | string | undefined | null): string | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Message-IDs from a References header, angle brackets and all whitespace tolerated. */
export function parseReferences(raw: string | null | undefined): string[] {
	if (!raw) return [];
	const ids = raw.match(/<[^<>\s]+>/g) ?? [];
	return [...new Set(ids)];
}

function referencesFromHeaders(headers: Buffer | undefined): string[] {
	if (!headers) return [];
	// Folded headers continue on lines starting with whitespace.
	const unfolded = headers.toString("latin1").replace(/\r?\n[ \t]+/g, " ");
	const line = unfolded.split(/\r?\n/).find((l) => /^references:/i.test(l));
	return parseReferences(line ? line.slice(line.indexOf(":") + 1) : null);
}

/**
 * Does the structure carry anything a person would call an attachment? Inline
 * images inside a related part do not count; a PDF does, whatever it is called.
 */
export function structureHasAttachments(node: MessageStructureObject | undefined): boolean {
	if (!node) return false;
	if (node.childNodes && node.childNodes.length > 0) {
		return node.childNodes.some(structureHasAttachments);
	}
	const disposition = (node.disposition ?? "").toLowerCase();
	if (disposition === "attachment") return true;
	const type = node.type.toLowerCase();
	if (type.startsWith("text/") || type.startsWith("multipart/")) return false;
	if (type.startsWith("image/") && disposition === "inline") return false;
	return true;
}

function toHeader(message: FetchMessageObject): RemoteHeader {
	const env = message.envelope;
	const envelope: RemoteEnvelope = {
		date: isoOf(env?.date),
		subject: env?.subject?.trim() ?? "",
		messageId: env?.messageId?.trim() || null,
		inReplyTo: parseReferences(env?.inReplyTo)[0] ?? null,
		references: referencesFromHeaders(message.headers),
		from: address(env?.from?.[0]),
		to: addresses(env?.to),
		cc: addresses(env?.cc),
		replyTo: addresses(env?.replyTo),
	};
	return {
		uid: message.uid,
		flags: [...(message.flags ?? [])],
		internalDate: isoOf(message.internalDate) ?? envelope.date ?? new Date().toISOString(),
		size: message.size ?? null,
		envelope,
		hasAttachments: structureHasAttachments(message.bodyStructure),
	};
}

export async function openImapSource(connection: MailConnection): Promise<MailboxSource> {
	const client = new ImapFlow({
		host: connection.host,
		port: connection.port,
		secure: connection.security === "tls",
		auth: { user: connection.username, pass: connection.password },
		logger: false,
		// The sync runs commands back to back and then logs out; an IDLE between
		// two of them is two wasted round trips, and there is nothing to wait for.
		disableAutoIdle: true,
		connectionTimeout: CONNECT_TIMEOUT_MS,
		clientInfo: { name: "Juno" },
	});

	try {
		await client.connect();
	} catch (error) {
		client.close();
		throw error;
	}

	// starttls means "upgrade", never "plain if the server will not". A password
	// on a cleartext socket is the one mistake this file must not make.
	if (!client.secureConnection) {
		await client.logout().catch(() => undefined);
		throw new Error(
			`${connection.host} did not offer an encrypted connection. Juno will not send a password in the clear.`,
		);
	}

	let closed = false;

	const source: MailboxSource = {
		async listFolders(): Promise<RemoteFolder[]> {
			const listed = await client.list();
			return listed.map((folder) => ({
				path: folder.path,
				name: folder.name,
				delimiter: folder.delimiter || null,
				specialUse:
					folder.path.toUpperCase() === "INBOX"
						? "inbox"
						: folder.specialUse
							? (SPECIAL_USE[folder.specialUse] ?? null)
							: null,
			}));
		},

		async openFolder(path): Promise<RemoteMailbox> {
			const mailbox = await client.mailboxOpen(path, { readOnly: true });
			return {
				uidValidity: String(mailbox.uidValidity),
				uidNext: mailbox.uidNext,
				exists: mailbox.exists,
			};
		},

		async searchUids(query): Promise<number[]> {
			const found = new Set<number>();
			if (query.since) {
				const result = await client.search({ since: new Date(`${query.since}T00:00:00Z`) }, { uid: true });
				for (const uid of result || []) found.add(uid);
			}
			if (query.uidFrom !== undefined) {
				const result = await client.search({ uid: `${query.uidFrom}:*` }, { uid: true });
				// A "n:*" range on a server whose highest UID is below n returns that
				// highest UID, per the RFC. It is already local, so drop it.
				for (const uid of result || []) if (uid >= query.uidFrom) found.add(uid);
			}
			return [...found].sort((a, b) => a - b);
		},

		async fetchHeaders(uids): Promise<RemoteHeader[]> {
			const out: RemoteHeader[] = [];
			for (const part of chunk(uids)) {
				const messages = await client.fetchAll(
					part,
					{
						uid: true,
						flags: true,
						envelope: true,
						internalDate: true,
						size: true,
						bodyStructure: true,
						headers: ["references"],
					},
					{ uid: true },
				);
				for (const message of messages) out.push(toHeader(message));
			}
			return out;
		},

		async fetchFlags(uids): Promise<RemoteFlags[]> {
			const out: RemoteFlags[] = [];
			for (const part of chunk(uids)) {
				const messages = await client.fetchAll(part, { uid: true, flags: true }, { uid: true });
				for (const message of messages) {
					out.push({ uid: message.uid, flags: [...(message.flags ?? [])] });
				}
			}
			return out;
		},

		async fetchSource(uid, maxBytes): Promise<Buffer | null> {
			const download = await client.download(String(uid), undefined, { uid: true, maxBytes });
			if (!download?.content) return null;
			const chunks: Buffer[] = [];
			for await (const piece of download.content) {
				chunks.push(Buffer.isBuffer(piece) ? piece : Buffer.from(piece));
			}
			return Buffer.concat(chunks);
		},

		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			try {
				await client.logout();
			} catch {
				client.close();
			}
		},
	};

	return source;
}
