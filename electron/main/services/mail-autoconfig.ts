import { resolveMx } from "node:dns/promises";
import { MAIL_PROVIDERS, mailProvider, type MailProvider } from "../../shared/mail-providers";
import type { MailAutoconfig, MailProviderId, MailSecurity, MailSignIn } from "../../shared/types";

/**
 * Server settings guessed from an address, so that adding an account is one
 * password rather than six fields copied out of a support article.
 *
 * `guess` is a table and a string operation, and touches no network at all.
 * That is the default because Juno is offline-first and because a provider's
 * autoconfig endpoint is a request to a third party announcing which mail
 * provider this person uses, sent before they have agreed to anything.
 *
 * The table only answers for addresses *at* a provider's own domain, or for a
 * provider the person picked from the tiles. Most businesses are neither: they
 * have their own domain hosted somewhere, and for those `guess` falls back to
 * imap./smtp., which a good share of hosts do not use. OVH is the example that
 * started this, where info@<customer domain> lives on imap.mail.ovh.net and
 * nothing about the domain says so.
 *
 * `resolveByMx` is the answer to that, and it is a separate call on purpose.
 * It asks DNS who handles mail for the domain, which is a network request, so
 * it happens when a person presses Next on an address the table does not know,
 * rather than behind their back. The MX host names the provider even when the
 * domain does not.
 *
 * No guess is ever saved on its own. It fills the form in, the hosts stay
 * visible, and the connection test is what decides whether it was right.
 */

type Servers = {
	imapHost: string;
	imapPort: number;
	imapSecurity: MailSecurity;
	smtpHost: string;
	smtpPort: number;
	smtpSecurity: MailSecurity;
};

/** A host Juno knows the servers of but offers no tile for. */
type Extra = Servers & {
	name: string;
	domains: string[];
	mxSuffixes: string[];
	signIn: MailSignIn;
	note?: string;
};

const TLS: MailSecurity = "tls";
const STARTTLS: MailSecurity = "starttls";

const APP_PASSWORD_NOTE =
	"This provider rejects your normal password from other applications. Make an app password in your account's security settings and use that here.";

const MICROSOFT_NOTE =
	"Microsoft no longer accepts a password from other applications. You sign in through Microsoft in your browser instead.";

const EXTRAS: Extra[] = [
	{
		name: "Scarlet",
		domains: ["scarlet.be"],
		mxSuffixes: [],
		imapHost: "imap.scarlet.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.scarlet.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "password",
	},
	{
		name: "VOO",
		domains: ["voo.be", "edpnet.be"],
		mxSuffixes: [],
		imapHost: "imap.voo.be",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.voo.be",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "password",
	},
	{
		name: "Proton",
		domains: ["protonmail.com", "proton.me", "pm.me"],
		mxSuffixes: [],
		imapHost: "127.0.0.1",
		imapPort: 1143,
		imapSecurity: STARTTLS,
		smtpHost: "127.0.0.1",
		smtpPort: 1025,
		smtpSecurity: STARTTLS,
		signIn: "password",
		note: "Proton only speaks IMAP through Proton Mail Bridge, running on this machine. Start the bridge and use the password it shows you, not your Proton password.",
	},
	{
		name: "one.com",
		domains: [],
		mxSuffixes: ["one.com"],
		imapHost: "imap.one.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "send.one.com",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "password",
	},
	{
		name: "TransIP",
		domains: [],
		mxSuffixes: ["transip.email"],
		imapHost: "imap.transip.email",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.transip.email",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "password",
	},
	{
		name: "Zoho",
		domains: [],
		mxSuffixes: ["zoho.eu"],
		imapHost: "imap.zoho.eu",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp.zoho.eu",
		smtpPort: 465,
		smtpSecurity: TLS,
		signIn: "password",
	},
	{
		// Personal Outlook.com mail on a domain of its own. The tile is Outlook.com.
		name: "Outlook.com",
		domains: [],
		mxSuffixes: ["olc.protection.outlook.com"],
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapSecurity: TLS,
		smtpHost: "smtp-mail.outlook.com",
		smtpPort: 587,
		smtpSecurity: STARTTLS,
		signIn: "microsoft",
	},
];

/** The part after the @, lowercased. Empty when the address has no single @. */
export function domainOf(email: string): string {
	const parts = email.trim().toLowerCase().split("@");
	if (parts.length !== 2) return "";
	return parts[1] ?? "";
}

function noteFor(signIn: MailSignIn, own?: string): string | null {
	if (own) return own;
	if (signIn === "app-password") return APP_PASSWORD_NOTE;
	if (signIn === "microsoft") return MICROSOFT_NOTE;
	return null;
}

function fromProvider(
	provider: MailProvider,
	email: string,
	domain: string,
	source: MailAutoconfig["source"],
): MailAutoconfig {
	const address = email.trim();
	const local = address.split("@")[0] ?? address;
	return {
		source,
		domain,
		imapHost: provider.imapHost,
		imapPort: provider.imapPort,
		imapSecurity: provider.imapSecurity,
		smtpHost: provider.smtpHost,
		smtpPort: provider.smtpPort,
		smtpSecurity: provider.smtpSecurity,
		username: provider.imapLogin === "local" ? local : address,
		smtpUsername: provider.imapLogin === "local" ? address : null,
		note: noteFor(provider.signIn),
		provider: provider.id,
		providerName: provider.name,
		signIn: provider.signIn,
	};
}

function fromExtra(extra: Extra, email: string, domain: string, source: MailAutoconfig["source"]): MailAutoconfig {
	// The Outlook.com extra is the Outlook.com tile reached through DNS.
	const tile = extra.signIn === "microsoft" ? mailProvider("outlook") : null;
	return {
		source,
		domain,
		imapHost: extra.imapHost,
		imapPort: extra.imapPort,
		imapSecurity: extra.imapSecurity,
		smtpHost: extra.smtpHost,
		smtpPort: extra.smtpPort,
		smtpSecurity: extra.smtpSecurity,
		username: email.trim(),
		smtpUsername: null,
		note: noteFor(extra.signIn, extra.note),
		provider: tile?.id ?? null,
		providerName: extra.name,
		signIn: extra.signIn,
	};
}

/**
 * Settings for an address. Always returns something: a domain nobody has heard
 * of still gets imap./smtp. in front of it, which is the convention most small
 * hosts follow, and the test is what confirms it.
 *
 * With `provider`, the person picked a tile, so that provider's servers are
 * used whatever the domain is. That is how info@<own domain> reaches OVH or
 * Combell without a lookup.
 */
export function guess(email: string, provider?: MailProviderId | null): MailAutoconfig {
	const domain = domainOf(email);
	if (domain.length === 0) {
		throw new Error("Enter a full email address, for example hallo@example.be.");
	}

	if (provider) {
		const chosen = mailProvider(provider);
		if (!chosen) throw new Error(`Juno does not know a provider called ${provider}.`);
		return fromProvider(chosen, email, domain, "known");
	}

	const known = MAIL_PROVIDERS.find((entry) => entry.domains.includes(domain));
	if (known) return fromProvider(known, email, domain, "known");

	const extra = EXTRAS.find((entry) => entry.domains.includes(domain));
	if (extra) return fromExtra(extra, email, domain, "known");

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
		smtpUsername: null,
		note: null,
		provider: null,
		providerName: null,
		signIn: "password",
	};
}

/** What DNS is asked. Injectable so the tests do not depend on a network. */
export type MxLookup = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

function hostMatches(exchange: string, suffix: string): boolean {
	const host = exchange.toLowerCase().replace(/\.$/, "");
	return host === suffix || host.endsWith(`.${suffix}`);
}

type MxEntry = { suffix: string; provider: MailProvider | null; extra: Extra | null };

/** Longest suffix first, so a specific entry beats a general one. */
const MX_ENTRIES: MxEntry[] = [
	...MAIL_PROVIDERS.flatMap((provider) =>
		provider.mxSuffixes.map((suffix) => ({ suffix, provider, extra: null })),
	),
	...EXTRAS.flatMap((extra) => extra.mxSuffixes.map((suffix) => ({ suffix, provider: null, extra }))),
].sort((a, b) => b.suffix.length - a.suffix.length);

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
		const match = MX_ENTRIES.find((entry) => hostMatches(record.exchange, entry.suffix));
		if (!match) continue;
		if (match.provider) return fromProvider(match.provider, email, domain, "mx");
		if (match.extra) return fromExtra(match.extra, email, domain, "mx");
	}

	return null;
}
