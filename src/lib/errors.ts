/** Service errors are written for people, so they are shown as they arrive. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
