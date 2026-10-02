import type {
	AgentActionState,
	AuditResult,
	AutomationRunStatus,
	AutomationTrigger,
} from "@shared/types";

export const ACTION_LABELS: Record<AgentActionState, string> = {
	pending: "Waiting for you",
	approved: "Approved",
	rejected: "Rejected",
	expired: "Expired",
	executed: "Done",
	failed: "Failed",
};

/** Tone is a token name, never a hex. See brand/BRAND.md section 5. */
export const ACTION_TONES: Record<AgentActionState, string> = {
	pending: "bg-[var(--warn-soft)] text-[var(--warn)]",
	approved: "bg-[var(--accent-soft)] text-[var(--accent)]",
	rejected: "bg-[var(--sunken)] text-[var(--ink-muted)]",
	expired: "bg-[var(--sunken)] text-[var(--ink-muted)]",
	executed: "bg-[var(--ok-soft)] text-[var(--ok)]",
	failed: "bg-[var(--risk-soft)] text-[var(--risk)]",
};

export const RUN_LABELS: Record<AutomationRunStatus, string> = {
	running: "Running",
	done: "Done",
	waiting: "Waiting for you",
	failed: "Failed",
	cancelled: "Cancelled",
};

export const RUN_TONES: Record<AutomationRunStatus, string> = {
	running: "bg-[var(--accent-soft)] text-[var(--accent)]",
	done: "bg-[var(--ok-soft)] text-[var(--ok)]",
	waiting: "bg-[var(--warn-soft)] text-[var(--warn)]",
	failed: "bg-[var(--risk-soft)] text-[var(--risk)]",
	cancelled: "bg-[var(--sunken)] text-[var(--ink-muted)]",
};

export const RESULT_TONES: Record<AuditResult, string> = {
	ok: "text-[var(--ok)]",
	failed: "text-[var(--risk)]",
	pending: "text-[var(--warn)]",
	rejected: "text-[var(--ink-muted)]",
	expired: "text-[var(--ink-muted)]",
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function describeTrigger(trigger: AutomationTrigger): string {
	switch (trigger.kind) {
		case "daily":
			return `Every day at ${trigger.time}`;
		case "weekly":
			return `Every ${WEEKDAYS[trigger.weekday - 1] ?? "week"} at ${trigger.time}`;
		default:
			return "Only when you run it";
	}
}

/** An instant as a local date and time, for a log a person reads. */
export function formatWhen(iso: string | null): string {
	if (!iso) return "";
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function formatArgs(args: Record<string, unknown>): string {
	return JSON.stringify(args, null, "\t");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", or the date. */
export function timeAgo(iso: string, nowMs: number): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const gap = nowMs - then;
	if (gap < MINUTE) return "just now";
	if (gap < HOUR) return `${Math.floor(gap / MINUTE)} min ago`;
	if (gap < DAY) return `${Math.floor(gap / HOUR)} h ago`;
	if (gap < 2 * DAY) return "yesterday";
	return formatWhen(iso);
}

/** How long a request can still be approved: "23 h left", "40 min left", "expired". */
export function timeLeft(iso: string, nowMs: number): string {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) return "";
	const gap = at - nowMs;
	if (gap <= 0) return "expired";
	if (gap < HOUR) return `${Math.max(1, Math.floor(gap / MINUTE))} min left`;
	return `${Math.floor(gap / HOUR)} h left`;
}

/** The heading a day's answered requests sit under. */
export function dayHeading(iso: string, nowMs: number): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	const days = Math.round((startOf(new Date(nowMs)) - startOf(at)) / DAY);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
}

export type MailPreview = {
	/** From, To, Cc, Bcc, Subject and Attached, in the order they were written. */
	headers: { label: string; value: string }[];
	body: string;
};

const HEADER = /^(From|To|Cc|Bcc|Subject|Attached): (.*)$/;

/**
 * Reads the preview of a mail request back into its parts, so the Agent tab can
 * draw it as a message rather than as a block of text. Null when it is not one,
 * which is then shown as it is.
 */
export function parseMailPreview(text: string): MailPreview | null {
	const lines = text.split("\n");
	const headers: MailPreview["headers"] = [];
	let index = 0;
	for (; index < lines.length; index += 1) {
		const match = HEADER.exec(lines[index] ?? "");
		if (!match) break;
		headers.push({ label: match[1]!, value: match[2]! });
	}
	if (!headers.some((header) => header.label === "To") || !headers.some((header) => header.label === "Subject")) {
		return null;
	}
	if (lines[index] === "") index += 1;
	return { headers, body: lines.slice(index).join("\n").trim() };
}
