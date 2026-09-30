import { statusBadgeClass } from "../lib/status-tone";

type StatusBadgeProps = {
	label: string;
	/** A token name from brand/tokens.css, never a hex. See brand/BRAND.md section 5. */
	tone: string | null;
};

/**
 * A reference item's label, in the tone that item carries. See
 * `lib/status-tone.ts` for the tone-to-class mapping, shared with anywhere
 * else a status's colour is drawn without the tag around it.
 */
export function StatusBadge({ label, tone }: StatusBadgeProps) {
	return (
		<span
			className={`inline-block shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${statusBadgeClass(tone)}`}
		>
			{label}
		</span>
	);
}
