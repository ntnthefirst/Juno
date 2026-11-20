import { useEffect, useId, useRef, useState } from "react";
import type { MailAccount, MailOutboxCounts, MailSyncStatus } from "@shared/types";
import { Icon } from "../../components/Icon";
import { STATUS_DOT, statusLines, summarise } from "./mail-status";

type MailStatusBarProps = {
	accounts: MailAccount[];
	sync: Record<string, MailSyncStatus>;
	/** What the operating system says about the network. */
	online: boolean;
	outbox: MailOutboxCounts | null;
	onRetry: (accountId: string) => void;
	/** Shows Outbox, where everything on its way out is listed. */
	onShowOutbox: () => void;
};

/**
 * What mail is doing, in one line at the foot of the folders, with a dot that
 * says how it stands. A click opens the list of every part on its own: each
 * account, anything that did not go, anything waiting for you, each with a
 * way to act on it.
 *
 * A mail client people trust says this without being asked, but six stacked
 * lines pushed the folders up every time two things went wrong at once. So the
 * line counts, and the list explains (decision 84).
 */
export function MailStatusBar({ accounts, sync, online, outbox, onRetry, onShowOutbox }: MailStatusBarProps) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const listId = useId();
	const lines = statusLines(accounts, sync, online, outbox, onRetry, onShowOutbox);
	const summary = summarise(lines, accounts);

	// Closes on a click anywhere else and on Escape, like any popover.
	useEffect(() => {
		if (!open) return;
		function onDown(event: MouseEvent) {
			if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={root} className="relative flex-none border-t border-[var(--line)] px-2 py-1.5">
			{open ? (
				<div
					id={listId}
					role="dialog"
					aria-label="Mail status"
					data-mail-status-list
					className="absolute right-2 bottom-full left-2 z-20 mb-1 flex animate-scale flex-col gap-0.5 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-popover)]"
				>
					{lines.map((line) => (
						<div key={line.key} className="flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2">
							{line.tone === "busy" ? (
								<Icon name="sync" size={12} className="mt-[4px] flex-none animate-spin text-[var(--accent)]" />
							) : (
								<span aria-hidden className={`mt-[6px] h-2 w-2 flex-none rounded-[var(--radius-full)] ${STATUS_DOT[line.tone]}`} />
							)}
							<div className="min-w-0 flex-1">
								<p className={`text-dense ${line.tone === "risk" ? "text-[var(--risk)]" : "text-[var(--ink)]"}`}>
									<span className="tabular">{line.text}</span>
								</p>
								{line.detail ? (
									<p data-selectable className="text-micro text-[var(--ink-muted)]">
										{line.detail}
									</p>
								) : null}
							</div>
							{line.action ? (
								<button
									type="button"
									onClick={() => {
										setOpen(false);
										line.action?.onClick();
									}}
									className="flex-none whitespace-nowrap rounded-[var(--radius-sm)] px-1.5 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--accent)] hover:bg-[var(--hover)]"
								>
									{line.action.label}
								</button>
							) : null}
						</div>
					))}
				</div>
			) : null}
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				data-mail-status
				data-tone={summary.tone}
				className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] px-2 text-left hover:bg-[var(--hover)]"
			>
				{summary.busy ? (
					<Icon name="sync" size={12} className="flex-none animate-spin text-[var(--accent)]" />
				) : (
					<span aria-hidden className={`h-2 w-2 flex-none rounded-[var(--radius-full)] ${STATUS_DOT[summary.tone]}`} />
				)}
				<span role="status" aria-live="polite" className="tabular min-w-0 flex-1 truncate text-dense text-[var(--ink-muted)]">
					{summary.text}
				</span>
				<Icon
					name="chevron-down"
					size={12}
					className={`flex-none text-[var(--ink-muted)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] ${open ? "" : "rotate-180"}`}
				/>
			</button>
		</div>
	);
}
