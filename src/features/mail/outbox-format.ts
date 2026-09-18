import type { MailOutboxState } from "@shared/types";

export const STATE_LABELS: Record<MailOutboxState, string> = {
	draft: "Draft",
	pending: "Waiting for you",
	queued: "Queued",
	sending: "Sending",
	sent: "Sent",
	failed: "Failed",
	cancelled: "Cancelled",
};

/** Tone is a token name, never a hex. */
export const STATE_TONES: Record<MailOutboxState, string> = {
	draft: "bg-[var(--sunken)] text-[var(--ink-muted)]",
	pending: "bg-[var(--warn-soft)] text-[var(--warn)]",
	queued: "bg-[var(--accent-soft)] text-[var(--accent)]",
	sending: "bg-[var(--accent-soft)] text-[var(--accent)]",
	sent: "bg-[var(--ok-soft)] text-[var(--ok)]",
	failed: "bg-[var(--risk-soft)] text-[var(--risk)]",
	cancelled: "bg-[var(--sunken)] text-[var(--ink-muted)]",
};
