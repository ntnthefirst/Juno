/**
 * Service errors are written for people, so they are shown as they arrive.
 *
 * Electron wraps anything thrown in a handler as "Error invoking remote method
 * 'x': Error: message". The wrapper says nothing a person can use, so it is
 * taken off and the sentence the service wrote is what is left.
 */
export function messageOf(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}
