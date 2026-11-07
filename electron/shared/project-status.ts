/**
 * A project counts as open unless its status says the work has ended. Matched on
 * the reference item's stable key rather than its label, because the label is
 * the owner's to rename.
 */
export const CLOSED_PROJECT_STATUS_KEYS = ["done", "completed", "delivered", "cancelled", "archived", "lost"];

export function isOpenProjectStatus(key: string | null | undefined): boolean {
	return !key || !CLOSED_PROJECT_STATUS_KEYS.includes(key);
}
