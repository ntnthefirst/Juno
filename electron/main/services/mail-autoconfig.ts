import { resolveMx } from "node:dns/promises";
import type { MailAutoconfig, MailSecurity } from "../../shared/types";

/**
 * Server settings guessed from an address, so that adding an account is one
 * password rather than six fields copied out of a support article.
 *
 * `guess` is a table and a string operation, and touches no network at all.
 * That is the default because Juno is offline-first and because a provider's
 * autoconfig endpoint is a request to a third party announcing which mail
 * provider this person uses, sent before they have agreed to anything.
 *
 * The table only answers for addresses *at* a provider's own domain. Most
 * businesses are not: they have their own domain hosted somewhere, and for
 * those `guess` falls back to imap./smtp., which a good share of hosts do not
 * use. OVH is the example that started this, where info@<customer domain>
 * lives on imap.mail.ovh.net and nothing about the domain says so.
 *
 * `resolveByMx` is the answer to that, and it is a separate call on purpose.
 * It asks DNS who handles mail for the domain, which is a network request, so
 * it happens when a person asks for it rather than behind their back. The MX
 * host names the provider even when the domain does not.
 *
 * No guess is ever saved on its own. It fills the form in, the hosts stay
 * visible, and the connection test is what decides whether it was right.
 */

type Provider = {
	/** Domains this entry answers for, lowercase, without the @. */
	domains: string[];
	imapHost: string;
	imapPort: number;
	imapSecurity: MailSecurity;
	smtpHost: string;
	smtpPort: number;
	smtpSecurity: MailSecurity;
	/** Shown when the provider needs something other than the login password. */
	note?: string;
};

const TLS: MailSecurity = "tls";
const STARTTLS: MailSecurity = "starttls";

const APP_PASSWORD_NOTE =
	"This provider rejects your normal password from other applications. Make an app password in your account's security settings and use that here.";

const PROVIDERS: Provider[] = [
	{
		domains: ["gmail.com", "googlemail.com"],
		imapHost: "imap.gmail.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.gmail.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		note: APP_PASSWORD_NOTE,
	},
	{
		domains: ["outlook.com", "hotmail.com", "live.com", "live.be", "msn.com", "office365.com"],
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.office365.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		note: APP_PASSWORD_NOTE,
	},
	{
		domains: ["icloud.com", "me.com", "mac.com"],
		imapHost: "imap.mail.me.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.me.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		note: APP_PASSWORD_NOTE,
	},
	{
		domains: ["yahoo.com", "yahoo.co.uk", "ymail.com"],
		imapHost: "imap.mail.yahoo.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.yahoo.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		note: APP_PASSWORD_NOTE,
	},
	// The Belgian providers a small business here is most likely to be on.
	{
		domains: ["telenet.be"],
		imapHost: "imap.telenet.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.telenet.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
	},
	{
		domains: ["skynet.be", "proximus.be", "belgacom.net"],
		imapHost: "imap.proximus.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.proximus.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
	},
	{
		domains: ["scarlet.be"],
		imapHost: "imap.scarlet.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.scarlet.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
	},
	{
		domains: ["voo.be", "edpnet.be"],
		imapHost: "imap.voo.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.voo.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
	},
	{
		domains: ["protonmail.com", "proton.me", "pm.me"],
		imapHost: "127.0.0.1",
		imapPort: 1143,
		imapSecurity: STARTTLS,
		smtpHost: "127.0.0.1",
		smtpPort: 1025,
		smtpSecurity: STARTTLS,
		note: "Proton only speaks IMAP through Proton Mail Bridge, running on this machine. Start the bridge and use the password it shows you, not your Proton password.",
	},
];

/**
 * Mail hosts, by the suffix their MX records use.
 *
 * Longest suffix wins, so a more specific entry can sit in front of a general
 * one. Matched on a dot boundary: "ovh.net" must not match "notovh.net".
 */
const MX_HOSTS: { suffix: string; imapHost: string; imapPort: number; imapSecurity: MailSecurity; smtpHost: string; smtpPort: number; smtpSecurity: MailSecurity; note?: string }[] = [
	{
		suffix: "ovh.net",
		imapHost: "imap.mail.ovh.net",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.ovh.net",
		smtpPort: 465,
		smtpSecurity: TLS,
	},
	{
		suffix: "mailprotect.be",
		imapHost: "imap.mailprotect.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mailprotect.be",
		smtpPort: 465,
		smtpSecurity: TLS,
	},
	{
		suffix: "one.com",
		imapHost: "imap.one.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "send.one.com",
		smtpPort: 465,
		smtpSecurity: TLS,
	},
	{
		suffix: "transip.email",
		imapHost: "imap.transip.email",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.transip.email",
		smtpPort: 465,
		smtpSecurity: TLS,
	},
	{
		suffix: "zoho.eu",
		imapHost: "imap.zoho.eu",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.zoho.eu",
		smtpPort: 465,
		smtpSecurity: TLS,
	},
	{
		suffix: "google.com",
		imapHost: "imap.gmail.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.gmail.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		note: APP_PASSWORD_NOTE,
	},
	{
		suffix: "outlook.com",
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.office365.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		note: APP_PASSWORD_NOTE,
	},
	{
		suffix: "yahoodns.net",
		imapHost: "imap.mail.yahoo.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.yahoo.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		note: APP_PASSWORD_NOTE,
	},
];

/** The part after the @, lowercased. Empty when the address has no single @. */
export function domainOf(email: string): string {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2) return "";
	return parts[1] ?? "";
}

/**
 * Settings for an address. Always returns something: a domain nobody has heard
 * of still gets imap./smtp. in front of it, which is the convention most small
 * hosts follow, and the test button is what confirms it.
 */
export function guess(email: string): MailAutoconfig {
	const domain = domainOf(email);
	if (domain.length === 0) {
		throw new Error("Enter a full email address, for example hallo@example.be.");
	}

	const known = PROVIDERS.find((provider) => provider.domains.includes(domain));
	if (known) {
		return {
			source: "known",
			domain,
			imapHost: known.imapHost,
			imapPort: known.imapPort,
			imapSecurity: known.imapSecurity,
			smtpHost: known.smtpHost,
			smtpPort: known.smtpPort,
			smtpSecurity: known.smtpSecurity,
			username: email.trim(),
			note: known.note ?? null,
		};
	}

	return {
		source: "convention",
		domain,
		imapHost: `imap.${domain}`,
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: `smtp.${domain}`,
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		username: email.trim(),
		note: null,
	};
}

/** What DNS is asked. Injectable so the tests do not depend on a network. */
export type MxLookup = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

function hostMatches(exchange: string, suffix: string): boolean {
	const host = exchange.toLowerCase().replace(/\.$/, "");
	return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Settings worked out from the domain's MX records.
 *
 * This is the one that gets a business with its own domain onto the right
 * servers: the domain says nothing, and its MX host says everything. It makes
 * a DNS query, so it runs when a person asks for it rather than as part of the
 * plain guess.
 *
 * Returns null when the MX host is not one Juno recognises, which is a real
 * answer worth showing: it means the convention guess is still the best there
 * is, rather than that the lookup failed.
 */
export async function resolveByMx(
	email: string,
	lookup: MxLookup = resolveMx,
): Promise<MailAutoconfig | null> {
	const domain = domainOf(email);
	if (domain.length === 0) {
		throw new Error("Enter a full email address, for example hallo@example.be.");
	}

	let records: { exchange: string; priority: number }[];
	try {
		records = await lookup(domain);
	} catch {
		throw new Error(
			`Could not look up who handles mail for ${domain}. Check the address, or fill the servers in by hand.`,
		);
	}

	// Lowest priority number is the primary, and is the one that names the
	// provider when the others are backups pointed somewhere else.
	const ordered = [...records].sort((a, b) => a.priority - b.priority);

	for (const record of ordered) {
		// Longest suffix first, so a specific entry beats a general one.
		const hosts = [...MX_HOSTS].sort((a, b) => b.suffix.length - a.suffix.length);
		const match = hosts.find((host) => hostMatches(record.exchange, host.suffix));
		if (!match) continue;
		return {
			source: "mx",
			domain,
			imapHost: match.imapHost,
			imapPort: match.imapPort,
			imapSecurity: match.imapSecurity,
			smtpHost: match.smtpHost,
			smtpPort: match.smtpPort,
			smtpSecurity: match.smtpSecurity,
			username: email.trim(),
			note: match.note ?? null,
		};
	}

	return null;
}
