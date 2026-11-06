type CountBadgeProps = {
	count: number | string;
	/** Warn is something waiting for you, accent is a plain count, quiet is a count that needs no attention. */
	tone?: "warn" | "accent" | "quiet";
};

const TONES = {
	warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
	accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
	quiet: "bg-[var(--sunken)] text-[var(--ink-muted)]",
};

/** A count beside a tab or a folder: an 18px pill. The rail uses a dot instead. */
export function CountBadge({ count, tone = "warn" }: CountBadgeProps) {
	return (
		<span
			className={`tabular inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-[var(--radius-full)] px-1.5 text-micro font-[var(--weight-medium)] ${TONES[tone]}`}
		>
			{count}
		</span>
	);
}
