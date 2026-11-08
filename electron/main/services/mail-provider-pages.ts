/**
 * Opening a provider's app password page in the browser. Apart from the
 * autoconfig service so that one stays testable in plain Node.
 *
 * The renderer names a provider and the address comes from the catalogue, so
 * a renderer never chooses what the system opens, and the page is checked for
 * https here as well (security.md sections 2 and 3).
 */
import { shell } from "electron";
import { mailProvider } from "../../shared/mail-providers";
import type { MailProviderId } from "../../shared/types";

export async function openProviderPage(id: MailProviderId): Promise<void> {
	const provider = mailProvider(id);
	if (!provider?.appPassword) {
		throw new Error("This provider has no app password page to open.");
	}
	const url = new URL(provider.appPassword.url);
	if (url.protocol !== "https:") throw new Error("Juno only opens https pages in the browser.");
	await shell.openExternal(url.href);
}
