import type { CalendarColour } from "@shared/types";

/**
 * A subscription's colour is stored as a token name and drawn from these
 * pairs: the soft tint behind a chip and the strong ink on it, which is also
 * the dot. Written out in full so Tailwind finds every class (styling.md
 * section 3). Brass is the seal note, offered here because the frame offers it.
 */
export const CALENDAR_TONES: Record<CalendarColour, { chip: string; dot: string; label: string }> = {
	accent: { chip: "bg-[var(--accent-soft)] text-[var(--accent)]", dot: "bg-[var(--accent)]", label: "Iris" },
	seal: { chip: "bg-[var(--seal-soft)] text-[var(--seal)]", dot: "bg-[var(--seal)]", label: "Brass" },
	"tone-1-ink": { chip: "bg-[var(--tone-1)] text-[var(--tone-1-ink)]", dot: "bg-[var(--tone-1-ink)]", label: "Slate" },
	"tone-2-ink": { chip: "bg-[var(--tone-2)] text-[var(--tone-2-ink)]", dot: "bg-[var(--tone-2-ink)]", label: "Blue" },
	"tone-3-ink": { chip: "bg-[var(--tone-3)] text-[var(--tone-3-ink)]", dot: "bg-[var(--tone-3-ink)]", label: "Teal" },
	"tone-4-ink": { chip: "bg-[var(--tone-4)] text-[var(--tone-4-ink)]", dot: "bg-[var(--tone-4-ink)]", label: "Green" },
	"tone-5-ink": { chip: "bg-[var(--tone-5)] text-[var(--tone-5-ink)]", dot: "bg-[var(--tone-5-ink)]", label: "Ochre" },
	"tone-6-ink": { chip: "bg-[var(--tone-6)] text-[var(--tone-6-ink)]", dot: "bg-[var(--tone-6-ink)]", label: "Rose" },
	"tone-7-ink": { chip: "bg-[var(--tone-7)] text-[var(--tone-7-ink)]", dot: "bg-[var(--tone-7-ink)]", label: "Plum" },
	"tone-8-ink": { chip: "bg-[var(--tone-8)] text-[var(--tone-8-ink)]", dot: "bg-[var(--tone-8-ink)]", label: "Grey" },
};

/** The six the Add calendar frame offers, in its order. */
export const OFFERED_COLOURS: CalendarColour[] = ["accent", "seal", "tone-1-ink", "tone-3-ink", "tone-5-ink", "tone-7-ink"];
