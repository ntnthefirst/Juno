/**
 * The body a message starts with once a rule has picked its greeting and
 * sign-off.
 *
 * `rest` is whatever the message already starts with: nothing for a new
 * message, and the quoted original (after the blank line the reply seed puts
 * in front of it) for a reply or a forward. The greeting goes on top, the
 * sign-off goes under the empty line the person writes on, and the quote stays
 * last, so a reply reads the way a mail client's own would.
 *
 *   Beste,
 *   (blank)
 *   (the person writes here)
 *   (blank)
 *   Met vriendelijke groeten,
 *   (blank)
 *   (quoted original)
 */
export function withPhrases(greeting: string | null, signoff: string | null, rest: string): string {
	// The quote is separated from what comes before it by a blank line. A rest
	// that does not start with a line break gets one, so a sign-off never runs
	// into the first word of it.
	const tail = rest === "" || rest.startsWith("\n") ? rest : `\n\n${rest}`;
	if (greeting && signoff) return `${greeting}\n\n\n\n${signoff}${tail}`;
	if (greeting) return `${greeting}\n\n${tail}`;
	if (signoff) return `\n\n${signoff}${tail}`;
	return rest;
}
