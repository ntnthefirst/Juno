import type { MailAccount, MailOutboxCounts, MailSyncStatus } from "@shared/types";
import { describeSync, formatSyncWhen, isSyncing } from "./format";

export type StatusTone = "ok" | "busy" | "warn" | "risk";

export type StatusLine = {
	key: string;
	tone: StatusTone;
	/** Something the person has to look at, as opposed to how things stand. */
	problem: boolean;
	text: string;
	detail?: string;
	action?: { label: string; onClick: () => void };
};

export const STATUS_DOT: Record<StatusTone, string> = {
	ok: "bg-[var(--ok)]",
	busy: "bg-[var(--accent)]",
	warn: "bg-[var(--warn)]",
	risk: "bg-[var(--risk)]",
};

/**
 * Everything mail could tell you right now, one line each: offline or not,
 * each account's sync, and what is waiting to go out. Problems come first.
 */
export function statusLines(
	accounts: MailAccount[],
	sync: Record<string, MailSyncStatus>,
	online: boolean,
	outbox: MailOutboxCounts | null,
	onRetry: (accountId: string) => void,
	onShowOutbox: () => void,
): StatusLine[] {
	const problems: StatusLine[] = [];
	const rest: StatusLine[] = [];

	if (!online) {
		problems.push({
			key: "offline",
			tone: "warn",
			problem: true,
			text: "Offline",
			detail: "Everything on this machine still opens. Juno syncs and sends when the connection is back.",
		});
	}

	if (outbox) {
		if (outbox.failed > 0) {
			problems.push({
				key: "outbox-failed",
				tone: "risk",
				problem: true,
				text: `${outbox.failed} ${outbox.failed === 1 ? "message was" : "messages were"} not sent`,
				action: { label: "Show", onClick: onShowOutbox },
			});
		}
		if (outbox.pending > 0) {
			problems.push({
				key: "outbox-pending",
				tone: "warn",
				problem: true,
				text: `${outbox.pending} waiting for your approval`,
				action: { label: "Show", onClick: onShowOutbox },
			});
		}
		if (outbox.queued > 0) {
			rest.push({
				key: "outbox-waiting",
				tone: online ? "busy" : "warn",
				problem: false,
				text: `${outbox.queued} waiting to send`,
				action: { label: "Show", onClick: onShowOutbox },
			});
		}
	}

	for (const account of accounts) {
		const status = sync[account.id] ?? null;
		if (isSyncing(status)) {
			rest.push({
				key: `sync:${account.id}`,
				tone: "busy",
				problem: false,
				text: `${account.label}: ${describeSync(status, account.lastSyncAt)}`,
			});
			continue;
		}
		const error = status?.phase === "failed" ? status.error : account.lastSyncError;
		if (error && online) {
			problems.push({
				key: `fail:${account.id}`,
				tone: "risk",
				problem: true,
				text: `${account.label} did not sync`,
				detail: error,
				action: { label: "Try again", onClick: () => onRetry(account.id) },
			});
			continue;
		}
		rest.push({
			key: `ok:${account.id}`,
			tone: "ok",
			problem: false,
			text: account.lastSyncAt ? `${account.label} is up to date` : `${account.label} has not synced yet`,
			...(account.lastSyncAt ? { detail: `Synced ${formatSyncWhen(account.lastSyncAt)}` } : {}),
		});
	}

	return [...problems, ...rest];
}

/**
 * How the line at the foot reads with everything folded into it. Green when
 * nothing needs you, yellow for one thing, red for more than one, or for one
 * that stops everything: no connection, or no account syncing at all.
 */
export function summarise(lines: StatusLine[], accounts: MailAccount[]): { tone: StatusTone; text: string; busy: boolean } {
	const problems = lines.filter((line) => line.problem);
	const failedAccounts = lines.filter((line) => line.key.startsWith("fail:")).length;
	const everything =
		lines.some((line) => line.key === "offline") || (accounts.length > 0 && failedAccounts === accounts.length);
	if (problems.length > 1) return { tone: "risk", text: `${problems.length} things need you`, busy: false };
	if (problems.length === 1) return { tone: everything ? "risk" : "warn", text: problems[0]!.text, busy: false };

	const syncing = lines.find((line) => line.key.startsWith("sync:"));
	if (syncing) return { tone: "ok", text: syncing.text, busy: true };
	const waiting = lines.find((line) => line.key === "outbox-waiting");
	if (waiting) return { tone: "ok", text: waiting.text, busy: true };
	const last = accounts
		.map((account) => account.lastSyncAt)
		.filter((at): at is string => at !== null)
		.sort()
		.pop();
	return { tone: "ok", text: last ? `Up to date, synced ${formatSyncWhen(last)}` : "Not synced yet", busy: false };
}
