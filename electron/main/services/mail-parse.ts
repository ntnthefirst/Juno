/**
 * Turning a raw message into rows: mailparser on the way in, and the small
 * pure functions the list and the threading depend on.
 *
 * Everything in here treats the message as an attacker's file. Filenames lose
 * their path separators, subjects lose their control characters, and nothing
 * is evaluated.
 */
import { simpleParser, type AddressObject } from "mailparser";
import type { MailAddress } from "../../shared/types";

/** Bodies larger than this are not fetched. Nobody reads a 40 MB email. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export const SNIPPET_LENGTH = 160;

export interface ParsedAttachment {
	filename: string;
	mimeType: string;
	size: number;
	content: Buffer;
	contentId: string | null;
	isInline: boolean;
}

export interface ParsedMessage {
	messageId: string | null;
	inReplyTo: string | null;
	references: string[];
	subject: string;
	date: string | null;
	from: MailAddress | null;
	to: MailAddress[];
	cc: MailAddress[];
	replyTo: MailAddress[];
	text: string | null;
	html: string | null;
	attachments: ParsedAttachment[];
}

/** Control characters other than tab, newline and carriage return. */
const CONTROL = /(?![\t\n\r])\p{Cc}/gu;

export function cleanSubject(value: string | null | undefined): string {
	return (value ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

/**
 * The subject with reply and forward prefixes gone, lowercased, for grouping
 * and display. Handles the Dutch and German forms a Belgian mailbox sees as
 * well as the English ones, and the "[list]" tags mailing software adds.
 */
export function normaliseSubject(value: string | null | undefined): string {
	let subject = cleanSubject(value).toLowerCase();
	const prefix = /^((re|fw|fwd|aw|wg|antw|antwoord|doorst|tr|sv|vs)\s*(\[\d+\])?\s*:\s*|\[[^\]]{1,40}\]\s*)+/i;
	subject = subject.replace(prefix, "");
	return subject.trim();
}

/** The first line or so of the text body, as one line, for the list. */
export function snippetOf(text: string | null | undefined): string {
	if (!text) return "";
	const lines: string[] = [];
	for (const line of text.replace(CONTROL, "").split(/\r?\n/)) {
		// Everything under a signature separator is the signature.
		if (/^--\s*$/.test(line)) break;
		// Quoted replies are not the message.
		if (/^\s*>/.test(line)) continue;
		lines.push(line);
	}
	const flat = lines
		.join(" ")
		// Text derived from HTML carries every link and image as "[https://...]".
		.replace(/\[https?:\/\/[^\]\s]*\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH - 3).trimEnd()}...` : flat;
}

/**
 * A filename the message supplied, made safe to join onto a directory. Path
 * separators and traversal go, control characters go, reserved Windows names
 * get a prefix, and an empty result gets a generic name.
 */
export function safeFilename(value: string | null | undefined, fallback = "attachment"): string {
	// Only the last path segment is a name. The rest is an attempt to escape.
	const last = (value ?? "").split(/[\\/]/).pop() ?? "";
	let name = last
		.replace(CONTROL, "")
		.replace(/[:*?"<>|]/g, "_")
		.replace(/^\.+/, "")
		.trim();
	if (!name || name === "." || name === "..") name = fallback;
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = `_${name}`;
	// Long names break on Windows once the directory is added.
	if (name.length > 120) {
		const dot = name.lastIndexOf(".");
		const ext = dot > 0 ? name.slice(dot).slice(0, 12) : "";
		name = name.slice(0, 120 - ext.length) + ext;
	}
	return name;
}

function toAddresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
	const objects = value === undefined ? [] : Array.isArray(value) ? value : [value];
	const out: MailAddress[] = [];
	for (const object of objects) {
		for (const entry of object.value) {
			if (!entry.address) continue;
			out.push({
				name: entry.name?.trim() || null,
				address: entry.address.trim().toLowerCase(),
			});
		}
	}
	return out;
}

function bracket(id: string | undefined): string | null {
	if (!id) return null;
	const trimmed = id.trim();
	if (!trimmed) return null;
	return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}

export async function parseMessage(source: Buffer): Promise<ParsedMessage> {
	const mail = await simpleParser(source, {
		// An HTML-only message still gets a text body, so the snippet and the
		// search have something to read. The reverse is not wanted: a text-only
		// message is shown as text, and no HTML is invented for it.
		skipHtmlToText: false,
		skipTextToHtml: true,
		skipImageLinks: true,
	});

	const references = (
		Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : []
	)
		.map((r) => bracket(r))
		.filter((r): r is string => r !== null);

	const attachments: ParsedAttachment[] = mail.attachments.map((attachment) => ({
		filename: safeFilename(attachment.filename),
		mimeType: attachment.contentType || "application/octet-stream",
		size: attachment.size,
		content: attachment.content,
		contentId: attachment.cid ?? null,
		isInline: Boolean(attachment.related) || attachment.contentDisposition === "inline",
	}));

	return {
		messageId: bracket(mail.messageId),
		inReplyTo: bracket(mail.inReplyTo),
		references,
		subject: cleanSubject(mail.subject),
		date: mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date.toISOString() : null,
		from: toAddresses(mail.from)[0] ?? null,
		to: toAddresses(mail.to),
		cc: toAddresses(mail.cc),
		replyTo: toAddresses(mail.replyTo),
		text: mail.text ?? null,
		html: mail.html === false ? null : mail.html,
		attachments,
	};
}
