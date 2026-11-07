import { useEffect, useState } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type LinkMailDialogProps = {
	projectId: string;
	projectName: string;
	onClose: () => void;
	onLinked: () => void;
};

/** Long enough that a word typed in one go is one search. */
const SEARCH_DELAY_MS = 250;

/** How many conversations one search lists. */
const PAGE = 30;

/**
 * Picks a conversation to show on a project. Picking is the answer, so there is
 * no second step. It is the same link the reader's "File under a project" makes
 * from the other side, and it leaves the thread's client alone.
 */
export function LinkMailDialog({ projectId, projectName, onClose, onLinked }: LinkMailDialogProps) {
	const [search, setSearch] = useState("");
	const [threads, setThreads] = useState<MailThreadSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Whether the service filled the page, so more mail exists than is listed.
	const [pageFull, setPageFull] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(
			() => {
				window.juno.mail.threads
					.list({ ...(search.trim() ? { search: search.trim() } : {}), limit: PAGE })
					.then((rows) => {
						if (cancelled) return;
						setPageFull(rows.length >= PAGE);
						setThreads(rows.filter((row) => row.projectId !== projectId));
					})
					.catch((cause: unknown) => {
						if (!cancelled) setError(messageOf(cause));
					});
			},
			search ? SEARCH_DELAY_MS : 0,
		);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [search, projectId]);

	async function pick(thread: MailThreadSummary) {
		setBusy(true);
		setError(null);
		try {
			await window.juno.mail.threads.linkProject(thread.id, projectId);
			onLinked();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<Dialog title={`Link a mail to ${projectName}`} onClose={onClose} width="narrow">
			<input
				type="search"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				placeholder="Search mail by subject, sender or text"
				aria-label="Search mail"
				autoFocus
				className="mt-4 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
			/>
			{error ? (
				<p role="alert" data-selectable className="mt-3 text-sm text-[var(--risk)]">
					{error}
				</p>
			) : null}
			<ul className="mt-3 max-h-[340px] overflow-y-auto">
				{threads === null ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">Loading.</li>
				) : threads.length === 0 ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">
						{search ? "No conversation matches." : "There is no mail to link yet."}
					</li>
				) : (
					threads.map((thread) => {
						const first = thread.participants[0];
						const who = first ? first.name || first.address : (thread.clientName ?? "");
						return (
							<li key={thread.id}>
								<button
									type="button"
									disabled={busy}
									onClick={() => void pick(thread)}
									className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								>
									<Avatar name={who || thread.subject} size={28} />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-dense font-[var(--weight-medium)]">{thread.subject}</span>
										<span className="block truncate text-sm text-[var(--ink-muted)]">
											{who}
											{thread.projectName ? ` / now on ${thread.projectName}` : ""}
										</span>
									</span>
								</button>
							</li>
						);
					})
				)}
			</ul>
			{pageFull ? (
				<p className="mt-2 text-sm text-[var(--ink-muted)]">Showing the first {PAGE}. Type to narrow the list.</p>
			) : null}
		</Dialog>
	);
}
