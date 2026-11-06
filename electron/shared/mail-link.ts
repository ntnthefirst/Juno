/**
 * Which addresses from a message may reach the shell. The reader and the main
 * process share it, so the popover cannot offer what the main process refuses.
 */

/** A web address on https, the only kind the reader offers to open. */
export function isHttpsLink(url: string): boolean {
	if (!/^https:\/\//i.test(url)) return false;
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * What the main process hands to the shell: a web address or a mailto.
 * Anything else a message carries is data, never a command.
 */
export function isShellLink(url: string): boolean {
	return /^(https?:\/\/|mailto:)/i.test(url);
}
