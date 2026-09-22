import type { MailAutoconfig, MailSecurity } from "../../shared/types";

/**
 * Server settings guessed from an address, so that adding an account is one
 * password rather than six fields copied out of a support article.
 *
 * Everything here is a lookup and a string operation. Nothing is fetched:
 * Juno is offline-first, and a provider's autoconfig endpoint is a request to
 * a third party that says which mail provider this person uses, sent before
 * they have agreed to anything. The table below covers what a Belgian small
 * business actually uses, and the fallback covers the rest well enough to be
 * worth offering.
 *
 * A guess is never saved on its own. It fills the form in, the person sees the
 * hosts, and the connection test is what decides whether it was right.
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
