/**
 * A reference item's tone, mapped to the classes that draw it.
 *
 * The tone is mapped to a class rather than written into a style attribute,
 * because a token that does not exist produces no class and no error in
 * Tailwind v4. An unknown tone lands on the neutral pair instead of rendering
 * unstyled. Kept out of `components/StatusBadge.tsx` so that file exports
 * nothing but the component: a function beside it there breaks fast refresh
 * for the component.
 */
const BADGE_TONES: Record<string, string> = {
	ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
	warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
	risk: "bg-[var(--risk-soft)] text-[var(--risk)]",
	seal: "bg-[var(--seal-soft)] text-[var(--seal)]",
	accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
};

const TEXT_TONES: Record<string, string> = {
	ok: "text-[var(--ok)]",
	warn: "text-[var(--warn)]",
	risk: "text-[var(--risk)]",
	seal: "text-[var(--seal)]",
	accent: "text-[var(--accent)]",
};

/** The badge's background and text pair. Falls back to the neutral pair. */
export function statusBadgeClass(tone: string | null): string {
	return (tone && BADGE_TONES[tone]) || "bg-[var(--sunken)] text-[var(--ink-muted)]";
}

/**
 * A status's own colour with nothing else drawn: no tag, no box, no
 * background. For the one place a status name reads as plain text, such as a
 * "Status changed from X to Y" timeline line, where the tag around it would
 * say two things happened rather than one.
 */
export function statusTextClass(tone: string | null): string {
	return (tone && TEXT_TONES[tone]) || "text-[var(--ink-muted)]";
}
