/**
 * A mailbox in memory for `npm run smoke` with JUNO_SMOKE_DEMO set.
 *
 * The smoke run has no server, and a run that never syncs proves nothing about
 * the scheme host, the frame policy or the reader. Three messages are enough
 * to exercise threading, an HTML body with a blocked image and a link, and an
 * attachment on disk. The transport at the bottom accepts anything, so the
 * outbox can be driven end to end as well. Never loaded outside the smoke run.
 */
import type { MailboxSource, RemoteHeader } from "./services/mail-source";
import type { MailboxWriter } from "./services/mail-writer";
import type { MailTransport, SentAppender } from "./services/mail-transport";

interface Sample {
	uid: number;
	from: { name: string; address: string };
	subject: string;
	messageId: string;
	inReplyTo: string | null;
	date: string;
	flags: string[];
	source: string;
	hasAttachments: boolean;
}

function ago(hours: number): string {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function rfc822(headers: string[], body: string[]): string {
	return [...headers, "MIME-Version: 1.0", ...body].join("\r\n");
}

const SAMPLES: Sample[] = [
	{
		uid: 1,
		from: { name: "Laura", address: "laura@obet.be" },
		subject: "Offerte website",
		messageId: "<offerte-1@obet.be>",
		inReplyTo: null,
		date: ago(50),
		flags: ["\\Seen"],
		hasAttachments: false,
		source: rfc822(
			[
				"From: Laura <laura@obet.be>",
				"To: hallo@juno.test",
				"Subject: Offerte website",
				"Message-ID: <offerte-1@obet.be>",
				`Date: ${new Date(ago(50)).toUTCString()}`,
			],
			[
				'Content-Type: text/plain; charset="utf-8"',
				"",
				"Dag Nathan,",
				"",
				"Kunnen we de offerte voor de nieuwe website nog eens bekijken? De hostingprijs lijkt me hoog.",
				"",
				"Groeten,",
				"Laura",
			],
		),
	},
	{
		uid: 2,
		from: { name: "Nathan", address: "hallo@juno.test" },
		subject: "Re: Offerte website",
		messageId: "<offerte-2@juno.test>",
		inReplyTo: "<offerte-1@obet.be>",
		date: ago(30),
		flags: ["\\Seen", "\\Answered"],
		hasAttachments: true,
		source: rfc822(
			[
				"From: Nathan <hallo@juno.test>",
				"To: Laura <laura@obet.be>",
				"Subject: Re: Offerte website",
				"Message-ID: <offerte-2@juno.test>",
				"In-Reply-To: <offerte-1@obet.be>",
				"References: <offerte-1@obet.be>",
				`Date: ${new Date(ago(30)).toUTCString()}`,
			],
			[
				'Content-Type: multipart/mixed; boundary="smoke"',
				"",
				"--smoke",
				'Content-Type: text/plain; charset="utf-8"',
				"",
				"Dag Laura, in bijlage de aangepaste offerte. De hosting staat nu op 35 euro per maand.",
				"--smoke",
				"Content-Type: application/pdf",
				'Content-Disposition: attachment; filename="offerte-v2.pdf"',
				"Content-Transfer-Encoding: base64",
				"",
				Buffer.from("%PDF-1.4 smoke").toString("base64"),
				"--smoke--",
			],
		),
	},
	{
		uid: 3,
		from: { name: "Hyge nieuwsbrief", address: "news@hyge.be" },
		subject: "Nieuw dit najaar",
		messageId: "<news-3@hyge.be>",
		inReplyTo: null,
		date: ago(2),
		flags: [],
		hasAttachments: false,
		source: rfc822(
			[
				"From: Hyge nieuwsbrief <news@hyge.be>",
				"To: hallo@juno.test",
				"Subject: Nieuw dit najaar",
				"Message-ID: <news-3@hyge.be>",
				`Date: ${new Date(ago(2)).toUTCString()}`,
			],
			[
				'Content-Type: text/html; charset="utf-8"',
				"",
				"<html><head><style>.hero { color: #333; background: url(https://hyge.example/bg.png) }</style></head>",
				'<body><div class="hero"><h1 style="font-size: 20px">Nieuw dit najaar</h1>',
				'<img src="https://hyge.example/track.gif" width="1" height="1">',
				'<p>Bekijk het <a href="https://hyge.example/aanbod">volledige aanbod</a>.</p>',
				'<p>De showroom is vrijdag om 10:00 open voor leveringen.</p>',
				'<p onclick="alert(1)"><script>alert(1)</script>Tot binnenkort.</p></div></body></html>',
			],
		),
	},
];

/**
 * A fourth message that is not in the mailbox until the run asks for it, so a
 * mailbox rule has new mail to act on: everything above is older than the
 * moment the account was connected and is history to a rule.
 */
let late: Sample | null = null;
/** Messages the in-memory writer has moved out of the inbox. */
const moved = new Set<number>();

export function arriveSmokeMessage(): void {
	const date = new Date().toISOString();
	late = {
		uid: 4,
		from: { name: "Hyge nieuwsbrief", address: "news@hyge.be" },
		subject: "Winteraanbod",
		messageId: "<news-4@hyge.be>",
		inReplyTo: null,
		date,
		flags: [],
		hasAttachments: false,
		source: rfc822(
			[
				"From: Hyge nieuwsbrief <news@hyge.be>",
				"To: hallo@juno.test",
				"Subject: Winteraanbod",
				"Message-ID: <news-4@hyge.be>",
				`Date: ${new Date(date).toUTCString()}`,
			],
			['Content-Type: text/plain; charset="utf-8"', "", "De winterprijzen staan online."],
		),
	};
}

function everything(): Sample[] {
	return late ? [...SAMPLES, late] : SAMPLES;
}

function header(sample: Sample): RemoteHeader {
	return {
		uid: sample.uid,
		flags: sample.flags,
		internalDate: sample.date,
		size: sample.source.length,
		envelope: {
			date: sample.date,
			subject: sample.subject,
			messageId: sample.messageId,
			inReplyTo: sample.inReplyTo,
			references: sample.inReplyTo ? [sample.inReplyTo] : [],
			from: sample.from,
			to: [{ name: null, address: "hallo@juno.test" }],
			cc: [],
			replyTo: [],
		},
		hasAttachments: sample.hasAttachments,
	};
}

export async function openSmokeMailbox(): Promise<MailboxSource> {
	let current = "INBOX";
	return {
		async listFolders() {
			return [
				{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" },
				{ path: "Drafts", name: "Drafts", delimiter: "/", specialUse: "drafts" },
				{ path: "Sent", name: "Sent", delimiter: "/", specialUse: "sent" },
				{ path: "Trash", name: "Trash", delimiter: "/", specialUse: "trash" },
				// One folder the user made, so a run covers the shapes a list has
				// outside the special four.
				{ path: "Offertes", name: "Offertes", delimiter: "/", specialUse: null },
			];
		},
		async openFolder(path) {
			current = path;
			return { uidValidity: "1", uidNext: late ? 5 : 4, exists: everything().length };
		},
		async searchUids() {
			// Only the inbox ever sees the late message, and loses what a rule moved.
			return current === "INBOX"
				? everything().filter((s) => !moved.has(s.uid)).map((s) => s.uid)
				: SAMPLES.map((s) => s.uid);
		},
		async fetchHeaders(uids) {
			return everything().filter((s) => uids.includes(s.uid)).map(header);
		},
		async fetchFlags(uids) {
			return everything().filter((s) => uids.includes(s.uid)).map((s) => ({ uid: s.uid, flags: s.flags }));
		},
		async fetchSource(uid) {
			const sample = everything().find((s) => s.uid === uid);
			return sample ? Buffer.from(sample.source) : null;
		},
		async close() {
			return;
		},
	};
}

/** A transport that accepts everything and remembers it, for the smoke run. */
export const smokeTransport: MailTransport = {
	async verify() {
		return;
	},
	async send(_connection, message) {
		return {
			raw: Buffer.from(`smoke:${message.messageId}`),
			accepted: message.to.map((a) => a.address),
			rejected: [],
		};
	},
};

export const smokeAppender: SentAppender = async () => {
	return;
};

/**
 * A writer over the same in-memory mailbox, for the one smoke step that files
 * mail through a rule. It does what a server without UIDPLUS does: a move says
 * nothing about where the message landed.
 */
export async function openSmokeWriter(): Promise<MailboxWriter> {
	let open = "INBOX";
	return {
		async openFolder(path) {
			open = path;
			return { uidValidity: "1" };
		},
		async createFolder() {
			return;
		},
		async renameFolder() {
			return;
		},
		async deleteFolder() {
			return;
		},
		async setFlags(uids, add, remove) {
			for (const sample of everything().filter((entry) => uids.includes(entry.uid))) {
				const flags = new Set(sample.flags);
				for (const flag of add) flags.add(flag);
				for (const flag of remove) flags.delete(flag);
				sample.flags = [...flags];
			}
		},
		async move(uids) {
			if (open === "INBOX") for (const uid of uids) moved.add(uid);
			return new Map();
		},
		async expunge() {
			return;
		},
		async close() {
			return;
		},
	};
}
