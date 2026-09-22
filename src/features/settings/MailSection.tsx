import { useCallback, useEffect, useState } from "react";
import type { MailAccount, MailFolder } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";
import { formatWhen } from "../mail/format";
import { MailAccountForm } from "./MailAccountForm";
import { Section, SectionError } from "./Section";

export function MailSection({ onSaved }: { onSaved: (message: string) => void }) {
	const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState<{ account: MailAccount | null } | null>(null);
	const [removing, setRemoving] = useState<MailAccount | null>(null);
	const [foldersFor, setFoldersFor] = useState<string | null>(null);

	const refresh = useCallback(() => {
		window.juno.mail.accounts
			.list()
			.then(setAccounts)
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.accounts
			.list()
			.then((rows) => {
				if (!cancelled) setAccounts(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function remove() {
		if (!removing) return;
		const account = removing;
		setRemoving(null);
		try {
			await window.juno.mail.accounts.remove(account.id);
			onSaved(`${account.label} removed.`);
			refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	async function toggleSync(account: MailAccount) {
		try {
			await window.juno.mail.accounts.update(account.id, { syncEnabled: !account.syncEnabled });
			refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	// Adding an account is a sequence now, so it takes the settings pane rather
	// than stacking a dialog inside a window that is already a fixed size.
	if (form) {
		return (
			<MailAccountForm
				account={form.account}
				onClose={() => setForm(null)}
				onSaved={(saved) => {
					setForm(null);
					onSaved(form.account ? `${saved.label} saved.` : `${saved.label} added.`);
					refresh();
				}}
			/>
		);
	}

	// The list keeps its own padding, because the form above reaches the edges.
	return (
		<div className="px-6 py-5">
			<Section
				title="Mail accounts"
				description="IMAP accounts Juno reads from. Nothing is ever written back to the server: no flags, no moves, no deletes. Passwords go into the operating system keychain and are never shown again."
				action={
					<Button size="dense" variant="primary" onClick={() => setForm({ account: null })}>
						Add account
					</Button>
				}
			>
				{accounts === null ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : accounts.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No accounts yet.</p>
				) : (
					<ul className="flex flex-col">
						{accounts.map((account) => (
							<li
								key={account.id}
								className="flex items-center gap-4 border-b border-[var(--line)]/60 py-2 last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline gap-2">
										<span className="truncate font-[var(--weight-medium)]">{account.label}</span>
										{account.label !== account.email ? (
											<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												{account.email}
											</span>
										) : null}
									</div>
									<div className="mt-0.5 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{account.imapHost}:{account.imapPort} {account.imapSecurity.toUpperCase()}
										{", "}
										{account.hasCredential ? "password set" : "no password"}
										{", "}
										{account.smtpHost ? `sends via ${account.smtpHost}:${account.smtpPort}` : "read only"}
										{", "}
										{account.syncEnabled
											? `every ${account.syncIntervalMinutes} min, ${account.horizonDays} days back`
											: "sync off"}
										{account.lastSyncAt ? `, last synced ${formatWhen(account.lastSyncAt)}` : ""}
									</div>
									{account.lastSyncError ? (
										<p data-selectable className="mt-0.5 text-[length:var(--text-sm)] text-[var(--risk)]">
											{account.lastSyncError}
										</p>
									) : null}
								</div>
								<Button size="dense" onClick={() => setFoldersFor(account.id)}>
									Folders
								</Button>
								<Button size="dense" onClick={() => void toggleSync(account)}>
									{account.syncEnabled ? "Pause" : "Resume"}
								</Button>
								<Button size="dense" onClick={() => setForm({ account })}>
									Edit
								</Button>
								<Button size="dense" variant="danger" onClick={() => setRemoving(account)}>
									Remove
								</Button>
							</li>
						))}
					</ul>
				)}
				<SectionError message={error} />

				{foldersFor ? <FoldersDialog accountId={foldersFor} onClose={() => setFoldersFor(null)} /> : null}

				{removing ? (
					<Dialog title="Remove account" onClose={() => setRemoving(null)} width="narrow">
						<p className="mt-4 text-[var(--ink-muted)]">
							Remove {removing.label} and forget its password? The mail already on this machine
							stays. Nothing changes on the server.
						</p>
						<div className="mt-6 flex justify-end gap-2">
							<Button onClick={() => setRemoving(null)}>Cancel</Button>
							<Button variant="danger" onClick={() => void remove()}>
								Remove
							</Button>
						</div>
					</Dialog>
				) : null}
			</Section>
		</div>
	);
}

/** Which folders the sync pulls. The list comes from the last sync. */
function FoldersDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
	const [folders, setFolders] = useState<MailFolder[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.folders
			.list(accountId)
			.then((rows) => {
				if (!cancelled) setFolders(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [accountId]);

	async function toggle(folder: MailFolder) {
		try {
			const updated = await window.juno.mail.folders.setSyncEnabled(folder.id, !folder.syncEnabled);
			setFolders((current) => current?.map((f) => (f.id === updated.id ? updated : f)) ?? null);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	return (
		<Dialog title="Folders" onClose={onClose} width="narrow">
			<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Ticked folders are pulled on every sync. The inbox is on by default.
			</p>
			{folders === null ? (
				<p className="mt-4 text-[var(--ink-muted)]">Loading.</p>
			) : folders.length === 0 ? (
				<p className="mt-4 text-[var(--ink-muted)]">No folders listed yet. Sync the account first.</p>
			) : (
				<ul className="mt-3 max-h-[360px] overflow-y-auto">
					{folders.map((folder) => (
						<li key={folder.id}>
							<label
								className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-2 hover:bg-[var(--hover)]"
								style={{ height: "var(--row-height)" }}
							>
								<input
									type="checkbox"
									checked={folder.syncEnabled}
									onChange={() => void toggle(folder)}
									className="accent-[var(--accent)]"
								/>
								<span className="min-w-0 flex-1 truncate">{folder.path}</span>
								<span className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{folder.messageCount > 0 ? folder.messageCount : ""}
								</span>
							</label>
						</li>
					))}
				</ul>
			)}
			{error ? (
				<p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
			<div className="mt-4 flex justify-end">
				<Button onClick={onClose}>Done</Button>
			</div>
		</Dialog>
	);
}
