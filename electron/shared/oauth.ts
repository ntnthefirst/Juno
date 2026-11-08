/**
 * Signing in to Microsoft for mail (decision 73).
 *
 * The application (client) ID is build configuration, like the update feed
 * URL: it names this application to Microsoft and is public, so it may be
 * committed. It is not a secret, and there is no client secret at all. Juno is
 * a public client and proves each sign-in with PKCE instead.
 *
 * While it is empty, Microsoft sign-in is not set up in this copy of Juno, and
 * the Outlook.com and Microsoft 365 tiles say so instead of failing.
 */
export const MICROSOFT_CLIENT_ID = "";

/** "common" accepts both personal Microsoft accounts and work or school ones. */
export const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

/**
 * What Juno asks to be allowed. `offline_access` is what returns a refresh
 * token, so the person signs in once rather than every hour. `openid email`
 * returns the address signed in to, which is checked against the one typed.
 */
export const MICROSOFT_MAIL_SCOPES = [
	"offline_access",
	"https://outlook.office.com/IMAP.AccessAsUser.All",
	"https://outlook.office.com/SMTP.Send",
	"openid",
	"email",
] as const;

export function microsoftSignInConfigured(clientId: string = MICROSOFT_CLIENT_ID): boolean {
	return clientId.trim().length > 0;
}
