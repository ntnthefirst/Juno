import type { MailAccountInput, MailAutoconfig, MailSecurity } from "@shared/types";

/** The server fields as typed, before they are numbers. */
export type ServerValues = {
	imapHost: string;
	imapPort: string;
	imapSecurity: MailSecurity;
	smtpHost: string;
	smtpPort: string;
	smtpSecurity: MailSecurity;
	/** Empty means the address. */
	username: string;
	/** Empty means the same as `username`. */
	smtpUsername: string;
};

export const EMPTY_SERVERS: ServerValues = {
	imapHost: "",
	imapPort: "993",
	imapSecurity: "tls",
	smtpHost: "",
	smtpPort: "465",
	smtpSecurity: "tls",
	username: "",
	smtpUsername: "",
};

export function serversFrom(config: MailAutoconfig, email: string): ServerValues {
	const address = email.trim();
	return {
		imapHost: config.imapHost,
		imapPort: String(config.imapPort),
		imapSecurity: config.imapSecurity,
		smtpHost: config.smtpHost,
		smtpPort: String(config.smtpPort),
		smtpSecurity: config.smtpSecurity,
		// The address is the default, so an empty field says the same thing.
		username: config.username.toLowerCase() === address.toLowerCase() ? "" : config.username,
		smtpUsername: config.smtpUsername && config.smtpUsername.toLowerCase() !== address.toLowerCase() ? config.smtpUsername : "",
	};
}

/** The port that goes with a security setting, when the port was the other one's default. */
export function portFor(direction: "imap" | "smtp", security: MailSecurity, current: string): string {
	const [tls, starttls] = direction === "imap" ? ["993", "143"] : ["465", "587"];
	if (current !== tls && current !== starttls) return current;
	return security === "tls" ? tls : starttls;
}

export function summary(values: ServerValues): string {
	return `${values.imapHost}:${values.imapPort} · ${values.smtpHost}:${values.smtpPort}`;
}

/** What `mail.accounts.connect` is given for these servers, without the secret. */
export function inputFrom(email: string, values: ServerValues): Omit<MailAccountInput, "password" | "signInId"> {
	return {
		email: email.trim(),
		imapHost: values.imapHost.trim(),
		imapPort: Number(values.imapPort),
		imapSecurity: values.imapSecurity,
		smtpHost: values.smtpHost.trim(),
		smtpPort: Number(values.smtpPort),
		smtpSecurity: values.smtpSecurity,
		...(values.username.trim() ? { username: values.username.trim() } : {}),
		...(values.smtpUsername.trim() ? { smtpUsername: values.smtpUsername.trim() } : {}),
	};
}

/** The look of a text control, the same as `components/Field.tsx`. */
export const CONTROL =
	"h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)] disabled:opacity-50";

/** The label above a control or a row of them. */
export const LABEL = "mb-1.5 block text-sm font-[var(--weight-medium)] text-[var(--ink)]";
