import { useCallback, useEffect, useState } from "react";
import type { RemovedMailAccount } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";
import { formatBytes } from "../mail/format";
import { Section, SectionError } from "./Section";

type RemovedAccountsProps = {
	/** Changes when the account list does, so a fresh removal shows up here. */
	refreshKey: number;
	onDone: (message: string) => void;
};

const NUMBER = new Intl.NumberFormat("nl-BE");

function counted(count: number, singular: string, plural: string): string {
	return `${NUMBER.format(count)} ${count === 1 ? singular : plural}`;
}

/** "1.240 messages, 32 attachments and 3 composed messages", leaving out zeros. */
function contents(account: RemovedMailAccount): string {
	const parts = [counted(account.messages, "message", "messages")];
	if (account.attachments > 0) parts.push(counted(account.attachments, "attachment", "attachments"));
	if (account.outboxMessages > 0) {
		parts.push(counted(account.outboxMessages, "composed message", "composed messages"));
	}
	return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Mail left behind by accounts that were removed. Removing an account keeps
 * its messages, and this is where a person decides they can go. It is a
 * dialog with two answers, so it is a dialog and not a page (decision 30).
 */
export function RemovedAccounts({ refreshKey, onDone }: RemovedAccountsProps) {
	const [accounts, setAccounts] = useState<RemovedMailAccount[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<RemovedMailAccount | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(() => {
		window.juno.mail.accounts
			.removed()
			.then(setAccounts)
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.accounts
			.removed()
			.then((rows) => {
				if (!cancelled) setAccounts(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	async function purge() {
		if (!deleting || busy) return;
		const account = deleting;
		setBusy(true);
		setError(null);
		try {
			// The address goes back as the confirmation: the dialog is the person
			// reading it, and the service refuses anything that is not that address.
			const result = await window.juno.mail.accounts.purge(account.id, account.email);
			setDeleting(null);
			if (result.leftOnDisk > 0) {
				setError(
					`The mail of ${account.email} is deleted, but ${counted(result.leftOnDisk, "file", "files")} could not be removed from Juno's mail folder. Close anything that has them open and delete them by hand.`,
				);
			} else {
				onDone("Stored mail deleted.");
			}
		} catch (cause: unknown) {
			setDeleting(null);
			setError(messageOf(cause));
		} finally {
			setBusy(false);
			refresh();
		}
	}

	if (accounts.length === 0 && !error) return null;

	return (
		<Section
			title="Removed accounts"
			description="Removing an account keeps the mail Juno already pulled. Delete it here when you no longer need it. Nothing changes on the server."
		>
			{accounts.length > 0 ? (
				<ul className="flex flex-col">
					{accounts.map((account) => (
						<li
							key={account.id}
							className="flex items-center gap-4 border-b border-[var(--line)]/60 py-2 last:border-b-0"
						>
							<div className="min-w-0 flex-1">
								<div className="truncate font-[var(--weight-medium)]">{account.email}</div>
								<div className="tabular mt-0.5 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{contents(account)}
									{account.attachmentBytes > 0 ? ` (${formatBytes(account.attachmentBytes)} of files)` : ""}
								</div>
							</div>
							<Button size="dense" variant="danger" onClick={() => setDeleting(account)}>
								Delete stored mail
							</Button>
						</li>
					))}
				</ul>
			) : null}
			<SectionError message={error} />

			{deleting ? (
				<Dialog title="Delete stored mail" onClose={() => setDeleting(null)} width="narrow">
					<p className="mt-4 text-[var(--ink-muted)]">
						Delete {contents(deleting)} of {deleting.email} from this machine? What is on the
						server stays there. This cannot be undone.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setDeleting(null)}>Cancel</Button>
						<Button variant="danger" disabled={busy} onClick={() => void purge()}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</Section>
	);
}
