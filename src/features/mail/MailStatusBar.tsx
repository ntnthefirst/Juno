import type { MailAccount, MailOutboxCounts, MailSyncStatus } from "@shared/types";
import { Icon } from "../../components/Icon";
import { describeSync, formatSyncWhen, isSyncing } from "./format";

type MailStatusBarProps = {
	accounts: MailAccount[];
	sync: Record<string, MailSyncStatus>;
	/** What the operating system says about the network. */
	online: boolean;
	outbox: MailOutboxCounts | null;
	onRetry: (accountId: string) => void;
	/** Shows Drafts, where everything not sent yet is listed. */
	onShowOutbox: () => void;
};

type Line = {
	key: string;
	tone: "ok" | "busy" | "warn" | "risk";
	text: string;
	detail?: string;
	action?: { label: string; onClick: () => void };
};

const DOT: Record<Line["tone"], string> = {
	ok: "bg-[var(--ok)]",
	busy: "bg-[var(--accent)]",
	warn: "bg-[var(--warn)]",
	risk: "bg-[var(--risk)]",
};

/**
 * What mail is doing right now, in words, at the foot of the folders: offline
 * or not, which account is syncing and how far it got, which one failed and
 * why with a way to try again, and what is still waiting to go out.
 *
 * A mail client people trust says this without being asked. A sync that
 * failed an hour ago and a message that never left are exactly the things a
 * person does not notice until a client asks where the answer is, so each one
 * has a line here until it is resolved, and "Up to date" only shows when
 * nothing else does.
 */
export function MailStatusBar({ accounts, sync, online, outbox, onRetry, onShowOutbox }: MailStatusBarProps) {
	const lines: Line[] = [];

	if (!online) {
		lines.push({
			key: "offline",
			tone: "warn",
			text: "Offline",
			detail: "Everything on this machine still opens. Juno syncs and sends when the connection is back.",
		});
	}

	for (const account of accounts) {
		const status = sync[account.id] ?? null;
		if (isSyncing(status)) {
			lines.push({ key: `sync:${account.id}`, tone: "busy", text: `${account.label}: ${describeSync(status, account.lastSyncAt)}` });
			continue;
		}
		const error = status?.phase === "failed" ? status.error : account.lastSyncError;
		if (error && online) {
			lines.push({
				key: `fail:${account.id}`,
				tone: "risk",
				text: `${account.label} did not sync`,
				detail: error,
				action: { label: "Try again", onClick: () => onRetry(account.id) },
			});
		}
	}

	if (outbox) {
		const waiting = outbox.queued;
		if (outbox.failed > 0) {
			lines.push({
				key: "outbox-failed",
				tone: "risk",
				text: `${outbox.failed} ${outbox.failed === 1 ? "message was" : "messages were"} not sent`,
				action: { label: "Show", onClick: onShowOutbox },
			});
		}
		if (waiting > 0) {
			lines.push({
				key: "outbox-waiting",
				tone: online ? "busy" : "warn",
				text: `${waiting} waiting to send`,
				action: { label: "Show", onClick: onShowOutbox },
			});
		}
		if (outbox.pending > 0) {
			lines.push({
				key: "outbox-pending",
				tone: "warn",
				text: `${outbox.pending} waiting for your approval`,
				action: { label: "Show", onClick: onShowOutbox },
			});
		}
	}

	if (lines.length === 0) {
		const last = accounts
			.map((account) => account.lastSyncAt)
			.filter((at): at is string => at !== null)
			.sort()
			.pop();
		lines.push({ key: "ok", tone: "ok", text: last ? `Up to date, synced ${formatSyncWhen(last)}` : "Not synced yet" });
	}

	return (
		<div role="status" aria-live="polite" className="flex flex-none flex-col gap-1 border-t border-[var(--line)] px-4 py-2.5">
			{lines.map((line) => (
				<div key={line.key} className="flex min-w-0 items-start gap-2">
					{line.tone === "busy" ? (
						<Icon name="sync" size={12} className="mt-[3px] flex-none animate-spin text-[var(--accent)]" />
					) : (
						<span aria-hidden className={`mt-[6px] h-1.5 w-1.5 flex-none rounded-[var(--radius-full)] ${DOT[line.tone]}`} />
					)}
					<div className="min-w-0 flex-1">
						<p
							className={`truncate text-[length:var(--text-sm)] ${line.tone === "risk" ? "text-[var(--risk)]" : "text-[var(--ink-muted)]"}`}
							title={line.detail ?? line.text}
						>
							<span className="tabular">{line.text}</span>
						</p>
						{line.detail ? (
							<p data-selectable className="line-clamp-2 text-[length:var(--text-micro)] text-[var(--ink-muted)]" title={line.detail}>
								{line.detail}
							</p>
						) : null}
					</div>
					{line.action ? (
						<button
							type="button"
							onClick={line.action.onClick}
							className="flex-none rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--accent)] hover:bg-[var(--hover)]"
						>
							{line.action.label}
						</button>
					) : null}
				</div>
			))}
		</div>
	);
}
