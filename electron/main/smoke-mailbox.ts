/**
 * A mailbox in memory for `npm run smoke` with BUREAU_SMOKE_DEMO set.
 *
 * The smoke run has no server, and a run that never syncs proves nothing about
 * the scheme host, the frame policy or the reader. Three messages are enough
 * to exercise threading, an HTML body with a blocked image and a link, and an
 * attachment on disk. The transport at the bottom accepts anything, so the
 * outbox can be driven end to end as well. Never loaded outside the smoke run.
 */
import type { MailboxSource, RemoteHeader } from "./services/mail-source";
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
				"To: hallo@bureau.test",
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
		from: { name: "Nathan", address: "hallo@bureau.test" },
		subject: "Re: Offerte website",
		messageId: "<offerte-2@bureau.test>",
		inReplyTo: "<offerte-1@obet.be>",
		date: ago(30),
		flags: ["\\Seen", "\\Answered"],
		hasAttachments: true,
		source: rfc822(
			[
				"From: Nathan <hallo@bureau.test>",
				"To: Laura <laura@obet.be>",
				"Subject: Re: Offerte website",
				"Message-ID: <offerte-2@bureau.test>",
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
				"To: hallo@bureau.test",
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
				'<p onclick="alert(1)"><script>alert(1)</script>Tot binnenkort.</p></div></body></html>',
			],
		),
	},
];

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
			to: [{ name: null, address: "hallo@bureau.test" }],
			cc: [],
			replyTo: [],
		},
		hasAttachments: sample.hasAttachments,
	};
}

export async function openSmokeMailbox(): Promise<MailboxSource> {
	return {
		async listFolders() {
			return [
				{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" },
				{ path: "Sent", name: "Sent", delimiter: "/", specialUse: "sent" },
			];
		},
		async openFolder() {
			return { uidValidity: "1", uidNext: 4, exists: SAMPLES.length };
		},
		async searchUids() {
			return SAMPLES.map((s) => s.uid);
		},
		async fetchHeaders(uids) {
			return SAMPLES.filter((s) => uids.includes(s.uid)).map(header);
		},
		async fetchFlags(uids) {
			return SAMPLES.filter((s) => uids.includes(s.uid)).map((s) => ({ uid: s.uid, flags: s.flags }));
		},
		async fetchSource(uid) {
			const sample = SAMPLES.find((s) => s.uid === uid);
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
