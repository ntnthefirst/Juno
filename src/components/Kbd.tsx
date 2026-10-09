type KbdProps = {
	/** The keys, one string each: ["Ctrl", "K"]. */
	keys: string[];
	/** Inverse is for a dark surface, such as a tooltip. */
	tone?: "muted" | "inverse";
};

/**
 * A shortcut drawn as the keys that make it. One chip per key, because "Ctrl K"
 * as a single word reads as a name and as chips reads as something to press.
 */
export function Kbd({ keys, tone = "muted" }: KbdProps) {
	const chip =
		tone === "inverse"
			? "border-[var(--paper)]/25 bg-[var(--paper)]/10 text-[var(--paper)]/80"
			: "border-[var(--line)] bg-[var(--sunken)] text-[var(--ink-muted)]";

	return (
		<span className="inline-flex items-center gap-1">
			{keys.map((key, index) => (
				<kbd
					key={`${index}:${key}`}
					className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] border px-1 font-[var(--font-ui)] text-[length:var(--text-micro)] font-[var(--weight-medium)] leading-none ${chip}`}
				>
					{key}
				</kbd>
			))}
		</span>
	);
}
