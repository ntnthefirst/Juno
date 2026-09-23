/**
 * The mailbox writer over imapflow. The only file that changes a mailbox.
 *
 * It is a near copy of the connection setup in ./mail-imap.ts rather than a
 * shared helper, because the two exist to be told apart: that file cannot
 * write, this one can, and a shared `connect()` would be the seam where that
 * stops being true. The rules both files keep are the same and both matter:
 *
 * - The logger is off. imapflow at debug level logs the auth exchange.
 * - Every connection is logged out in a `finally`, including on the error path.
 *   Providers cap concurrent connections in the low single digits.
 * - starttls means upgrade, never "plain if the server will not".
 */
import { ImapFlow } from "imapflow";
import type { MailConnection } from "./mail-source";
import type { MailboxWriter } from "./mail-writer";

const CONNECT_TIMEOUT_MS = 30_000;

export async function openImapWriter(connection: MailConnection): Promise<MailboxWriter> {
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
	} catch (error) {
		client.close();
		throw error;
	}

	if (!client.secureConnection) {
		await client.logout().catch(() => undefined);
		throw new Error(
			`${connection.host} did not offer an encrypted connection. Juno will not send a password in the clear.`,
		);
	}

	let closed = false;

	const writer: MailboxWriter = {
		async openFolder(path) {
			const mailbox = await client.mailboxOpen(path, { readOnly: false });
			return { uidValidity: String(mailbox.uidValidity) };
		},

		async setFlags(uids, add, remove) {
			if (uids.length === 0) return;
			const range = uids.join(",");
			if (add.length > 0) await client.messageFlagsAdd(range, add, { uid: true });
			if (remove.length > 0) await client.messageFlagsRemove(range, remove, { uid: true });
		},

		async move(uids, toPath) {
			if (uids.length === 0) return new Map();
			const result = await client.messageMove(uids.join(","), toPath, { uid: true });
			// A false result means the server accepted nothing, which is a failure
			// worth reporting rather than an empty map that reads as "moved, but
			// where is unknown".
			if (result === false) throw new Error("The server refused the move.");
			// uidMap is only present when the server answered with COPYUID, which
			// needs UIDPLUS. Without it the caller has no way to know the new uid,
			// which it is written to cope with.
			const map = new Map<number, number>();
			for (const [from, to] of Object.entries(result.uidMap ?? {})) {
				const source = Number(from);
				const destination = Number(to);
				if (Number.isFinite(source) && Number.isFinite(destination)) map.set(source, destination);
			}
			return map;
		},

		async expunge(uids) {
			if (uids.length === 0) return;
			// messageDelete flags \Deleted and expunges in one call, and on a
			// server with the MOVE capability imapflow uses it directly.
			await client.messageDelete(uids.join(","), { uid: true });
		},

		async close() {
			if (closed) return;
			closed = true;
			try {
				await client.logout();
			} catch {
				client.close();
			}
		},
	};

	return writer;
}
