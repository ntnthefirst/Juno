/**
 * Service errors are written for people, so they are shown as they arrive.
 *
 * Electron wraps anything thrown in a handler as "Error invoking remote method
 * 'x': Error: message". The wrapper says nothing a person can use, so it is
 * taken off and the sentence the service wrote is what is left.
 */
export function messageOf(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const cleaned = message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
	failures.add(cleaned);
	if (failures.size > 200) failures.delete(failures.values().next().value as string);
	return cleaned;
}

/**
 * Sentences that came out of a failure. A toast draws the warning glyph for
 * these and the done glyph for everything else, without each caller saying so.
 */
const failures = new Set<string>();

export function isFailureMessage(message: string): boolean {
	return failures.has(message);
}
