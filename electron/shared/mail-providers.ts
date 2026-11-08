import type { MailProviderId, MailSecurity, MailSignIn } from "./types";

/**
 * The providers the Add account screen offers as tiles, in the order the
 * frame draws them, with the servers each one publishes.
 *
 * Every host, port and security setting here was checked against the
 * provider's own help pages on 2026-11-08:
 *
 * - Gmail: developers.google.com, "IMAP, POP, and SMTP".
 * - Outlook.com: support.microsoft.com, "POP, IMAP, and SMTP settings for
 *   Outlook.com". Modern authentication only, so no password route.
 * - Microsoft 365: the same page for work or school accounts.
 * - iCloud: support.apple.com/102525. The IMAP login is the name before the @,
 *   the SMTP login the whole address, and both take an app-specific password.
 * - OVH: docs.ovhcloud.com, "Getting started with the MX Plan solution".
 * - Proximus: imap.proximus.be and relay.proximus.be, from the Proximus
 *   e-mail settings article. There is no smtp.proximus.be.
 * - Telenet: www2.telenet.be, "E-mail instellen". Authenticated SMTP on 587.
 * - Yahoo: help.yahoo.com SLN4075.
 * - Combell: combell.com help, the Basic mailbox articles. smtp-auth, not smtp.
 *
 * This file is data the renderer reads to draw the tiles and the guides. The
 * guess itself, which decides what an address gets, is in
 * `main/services/mail-autoconfig.ts`.
 */
export type MailProvider = {
	id: MailProviderId;
	name: string;
	/** The muted line under the name on the tile. */
	line: string;
	/** The letter on a tile with no logo. */
	letter: string;
	/** `--tone-1` to `--tone-8` behind the letter. */
	tone: number;
	/** Addresses at these domains are this provider, without asking DNS. */
	domains: string[];
	/** MX hosts ending in these name this provider for a domain of its own. */
	mxSuffixes: string[];
	imapHost: string;
	imapPort: number;
	imapSecurity: MailSecurity;
	smtpHost: string;
	smtpPort: number;
	smtpSecurity: MailSecurity;
	/** "local" when the IMAP login is the part before the @. */
	imapLogin?: "local";
	signIn: MailSignIn;
	/** For an app-password provider: where the person makes one, and how. */
	appPassword?: {
		heading: string;
		steps: string[];
		/** The button that opens `url` in the browser. */
		open: string;
		/** Opened by the main process, after the https check. */
		url: string;
	};
};

const TLS: MailSecurity = "tls";
const STARTTLS: MailSecurity = "starttls";

export const MAIL_PROVIDERS: readonly MailProvider[] = [
	{
		id: "gmail",
		name: "Gmail",
		line: "Google",
		letter: "G",
		tone: 3,
		domains: ["gmail.com", "googlemail.com"],
		mxSuffixes: ["google.com", "googlemail.com"],
		imapHost: "imap.gmail.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.gmail.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "app-password",
		appPassword: {
			heading: "Gmail needs an app password",
			steps: [
				"Turn on 2-step verification in your Google account, if it is not on yet.",
				"Open App passwords and make one called Juno.",
				"Copy the 16 letters Google shows and paste them below.",
			],
			open: "Open App passwords",
			url: "https://myaccount.google.com/apppasswords",
		},
	},
	{
		id: "outlook",
		name: "Outlook.com",
		line: "Hotmail, Live",
		letter: "O",
		tone: 1,
		domains: ["outlook.com", "outlook.be", "hotmail.com", "hotmail.be", "live.com", "live.be", "msn.com"],
		mxSuffixes: [],
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp-mail.outlook.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "microsoft",
	},
	{
		id: "m365",
		name: "Microsoft 365",
		line: "Work or school",
		letter: "M",
		tone: 2,
		domains: [],
		// A domain on Microsoft 365 points its MX at <tenant>.mail.protection.outlook.com.
		mxSuffixes: ["mail.protection.outlook.com"],
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.office365.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "microsoft",
	},
	{
		id: "icloud",
		name: "iCloud",
		line: "App password",
		letter: "i",
		tone: 2,
		domains: ["icloud.com", "me.com", "mac.com"],
		mxSuffixes: ["mail.icloud.com"],
		imapHost: "imap.mail.me.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.me.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		imapLogin: "local",
		signIn: "app-password",
		appPassword: {
			heading: "iCloud needs an app-specific password",
			steps: [
				"Turn on two-factor authentication for your Apple Account, if it is not on yet.",
				"Open your Apple Account, go to Sign-In and Security, then App-Specific Passwords, and make one called Juno.",
				"Copy the password Apple shows and paste it below.",
			],
			open: "Open Apple Account",
			url: "https://account.apple.com/account/manage",
		},
	},
	{
		id: "ovh",
		name: "OVH",
		line: "Your own domain",
		letter: "O",
		tone: 5,
		domains: [],
		mxSuffixes: ["ovh.net"],
		imapHost: "imap.mail.ovh.net",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.ovh.net",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "password",
	},
	{
		id: "proximus",
		name: "Proximus",
		line: "proximus.be",
		letter: "P",
		tone: 6,
		domains: ["proximus.be", "skynet.be", "belgacom.net"],
		mxSuffixes: [],
		imapHost: "imap.proximus.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "relay.proximus.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "password",
	},
	{
		id: "telenet",
		name: "Telenet",
		line: "telenet.be",
		letter: "T",
		tone: 4,
		domains: ["telenet.be"],
		mxSuffixes: [],
		imapHost: "imap.telenet.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.telenet.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "password",
	},
	{
		id: "yahoo",
		name: "Yahoo",
		line: "App password",
		letter: "Y",
		tone: 7,
		domains: ["yahoo.com", "yahoo.be", "yahoo.fr", "yahoo.co.uk", "ymail.com"],
		mxSuffixes: ["yahoodns.net"],
		imapHost: "imap.mail.yahoo.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.mail.yahoo.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "app-password",
		appPassword: {
			heading: "Yahoo needs an app password",
			steps: [
				"Open Account security in your Yahoo account.",
				"Choose Generate app password and make one called Juno.",
				"Copy the password Yahoo shows and paste it below.",
			],
			open: "Open Account security",
			url: "https://login.yahoo.com/account/security",
		},
	},
	{
		id: "combell",
		name: "Combell",
		line: "Your own domain",
		letter: "C",
		tone: 2,
		domains: [],
		mxSuffixes: ["mailprotect.be"],
		imapHost: "imap.mailprotect.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp-auth.mailprotect.be",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "password",
	},
];

export function mailProvider(id: string | null | undefined): MailProvider | null {
	return MAIL_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/**
 * Which provider an existing account is at, for the logo on its row. Read from
 * the servers it uses, because those are what decide it; the address decides
 * only between the two Microsoft tiles, which share an IMAP host.
 */
export function providerOfAccount(account: { email: string; imapHost: string; smtpHost: string | null }): MailProvider | null {
	const host = account.imapHost.toLowerCase();
	const matches = MAIL_PROVIDERS.filter((provider) => provider.imapHost === host);
	if (matches.length <= 1) return matches[0] ?? null;
	const domain = account.email.toLowerCase().split("@")[1] ?? "";
	return (
		matches.find((provider) => provider.domains.includes(domain)) ??
		matches.find((provider) => provider.smtpHost === account.smtpHost?.toLowerCase()) ??
		matches.find((provider) => provider.domains.length === 0) ??
		matches[0] ??
		null
	);
}
