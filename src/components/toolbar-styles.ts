/**
 * Shared between VisualEditor's own buttons and InsertImageControl's toggle,
 * so the whole row reads as one toolbar rather than two components that
 * happen to sit next to each other.
 */
export const TOOLBAR_BUTTON =
	"flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40";

export const TOOLBAR_BUTTON_ACTIVE = "bg-[var(--accent-soft)] text-[var(--accent)]";
