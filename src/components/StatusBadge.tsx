type StatusBadgeProps = {
	label: string;
	/** A token name from brand/tokens.css, never a hex. See brand/BRAND.md section 5. */
	tone: string | null;
};

/**
 * A reference item's label, in the tone that item carries.
 *
 * The tone is mapped to a pair of classes rather than written into a style
 * attribute, because a token that does not exist produces no class and no
 * error in Tailwind v4. An unknown tone lands on the neutral pair instead of
 * rendering unstyled.
 */
const TONES: Record<string, string> = {
	ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
	warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
	risk: "bg-[var(--risk-soft)] text-[var(--risk)]",
	seal: "bg-[var(--seal-soft)] text-[var(--seal)]",
	accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
	const classes = (tone && TONES[tone]) || "bg-[var(--sunken)] text-[var(--ink-muted)]";
	return (
		<span
			className={`inline-block shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${classes}`}
		>
			{label}
		</span>
	);
}
