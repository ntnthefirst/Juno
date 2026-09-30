import type {
	AgentActionState,
	AgentClientTarget,
	AuditResult,
	AutomationRunStatus,
	AutomationTrigger,
	McpServerStatus,
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

/* ---------------------------------------------------------- manual install */

type WrittenConfig = { mcpServers: { juno: unknown } };

/** The JSON block to paste for a client that keeps its servers as JSON. */
function jsonSnippetFor(status: McpServerStatus, key: string): string {
	const parsed = JSON.parse(status.configJson) as WrittenConfig;
	return JSON.stringify({ [key]: { juno: parsed.mcpServers.juno } }, null, "\t");
}

/** The TOML table to paste for Codex, the one client that is not JSON. */
function tomlSnippetFor(status: McpServerStatus, key: string): string {
	const lines = [
		`[${key}.juno]`,
		`command = ${JSON.stringify(status.command)}`,
		`args = [${status.args.map((value) => JSON.stringify(value)).join(", ")}]`,
	];
	if (Object.keys(status.env).length > 0) {
		lines.push("", `[${key}.juno.env]`);
		for (const [envKey, value] of Object.entries(status.env)) {
			lines.push(`${envKey} = ${JSON.stringify(value)}`);
		}
	}
	return lines.join("\n");
}

/**
 * The block to paste for one client, shaped the way that client reads it.
 *
 * The key comes from the target the main process built, not from a table kept
 * here. A second copy of that mapping drifts the day a client renames its key,
 * and the screen it would be wrong on is the one telling a person where to
 * paste something by hand.
 */
export function snippetFor(target: AgentClientTarget, status: McpServerStatus): string {
	return target.format === "toml"
		? tomlSnippetFor(status, target.configKey)
		: jsonSnippetFor(status, target.configKey);
}
