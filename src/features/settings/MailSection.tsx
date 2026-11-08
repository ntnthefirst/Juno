import { useCallback, useEffect, useState } from "react";
import type { MailAccount } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { isMac } from "../../lib/platform";
import { PageHeader } from "./PageHeader";
import type { SettingsPage } from "./pages";
import { StatusBadge } from "../../components/StatusBadge";
import { messageOf } from "../../lib/errors";
import { providerOfAccount } from "@shared/mail-providers";
import { AddAccountFlow } from "./add-account/AddAccountFlow";
import { ProviderLogo } from "./add-account/ProviderLogo";
import { MailAccountForm } from "./MailAccountForm";
import { MailAccountPage } from "./mail-account/MailAccountPage";
import { RemovedAccounts } from "./RemovedAccounts";
import { Section, SectionError } from "./Section";
import { PAGE_PADDING } from "./section-layout";

type MailSectionProps = {
	onSaved: (message: string) => void;
	/** The page whose title is drawn here, because the account form replaces the whole page, header included. */
	page: SettingsPage;
};

export function MailSection({ onSaved, page }: MailSectionProps) {
	const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState<{ account: MailAccount | null } | null>(null);
	// The account being signed in to Microsoft again, while the browser is open.
	const [signingIn, setSigningIn] = useState<string | null>(null);
	const [removing, setRemoving] = useState<MailAccount | null>(null);
	// The account whose page is open: details, rules, history and folders.
	const [opened, setOpened] = useState<string | null>(null);
	// Bumped when an account is removed, so the removed list fetches again.
	const [removedVersion, setRemovedVersion] = useState(0);

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
			setRemovedVersion((version) => version + 1);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	async function signInAgain(account: MailAccount) {
		setSigningIn(account.id);
		setError(null);
		try {
			await window.juno.mail.accounts.signInAgain(account.id);
			onSaved(`${account.label} signed in again.`);
			refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setSigningIn(null);
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

	const openedAccount = opened ? accounts?.find((account) => account.id === opened) : undefined;
	if (openedAccount && !form) {
		return (
			<MailAccountPage
				account={openedAccount}
				onBack={() => setOpened(null)}
				onEdit={() => setForm({ account: openedAccount })}
				onSaved={onSaved}
			/>
		);
	}

	// Adding an account is a sequence, so it takes the settings pane rather
	// than stacking a dialog inside a window that is already a fixed size.
	if (form && !form.account) {
		return (
			<AddAccountFlow
				onClose={() => {
					setForm(null);
					refresh();
				}}
				onSaved={(saved) => {
					setForm(null);
					onSaved(`${saved.label} added.`);
					refresh();
				}}
			/>
		);
	}

	if (form) {
		return (
			<MailAccountForm
				account={form.account}
				onClose={() => setForm(null)}
				onSaved={(saved) => {
					setForm(null);
					onSaved(`${saved.label} saved.`);
					refresh();
				}}
			/>
		);
	}

	// The list keeps its own padding, because the form above reaches the edges.
	return (
		<div className={PAGE_PADDING}>
			<PageHeader
				page={page}
				action={
					<Button variant="primary" size="dense" onClick={() => setForm({ account: null })}>
						<Icon name="add" size={14} />
						Add account
					</Button>
				}
			/>
			{/* Wrapped, so the first section is the first child and drops its rule. */}
			<div>
				<Section
					title="Accounts"
					anchor="mail-accounts"
					lead
					description={`Passwords are stored by ${isMac ? "macOS" : "Windows"} and never shown again. Open an account for its folders, its rules and what they did.`}
				>
					{accounts === null ? (
						<p className="text-[var(--ink-muted)]">Loading.</p>
					) : accounts.length === 0 ? (
						<p className="text-[var(--ink-muted)]">No accounts yet.</p>
					) : (
						<ul className="flex flex-col gap-3">
							{accounts.map((account) => {
								const status = accountStatus(account);
								const provider = providerOfAccount(account);
								return (
									<li
										key={account.id}
										className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 py-3.5"
									>
										<ProviderLogo provider={provider} name={provider ? null : account.email} />
										<button
											type="button"
											aria-label={`Open ${account.label}`}
											data-account={account.id}
											onClick={() => setOpened(account.id)}
											className="min-w-0 flex-1 rounded-[var(--radius-md)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
										>
											<span className="block truncate text-base font-[var(--weight-medium)]">
												{account.email}
											</span>
											{provider ? (
												<span className="mt-0.5 block truncate text-sm text-[var(--ink-muted)]">
													{provider.name} · mail
												</span>
											) : (
												<span className="mt-0.5 block truncate font-mono text-sm text-[var(--ink-muted)]">
													{account.imapHost}:{account.imapPort}
													{account.smtpHost ? ` · ${account.smtpHost}:${account.smtpPort}` : " · read only"}
												</span>
											)}
											{account.lastSyncError ? (
												<span className="mt-0.5 block truncate text-sm text-[var(--risk)]">
													{account.lastSyncError}
												</span>
											) : null}
										</button>
										{/* The button says it when Microsoft wants a sign-in, so the badge would repeat it. */}
										{account.needsSignIn ? null : <StatusBadge label={status.label} tone={status.tone} />}
										{account.needsSignIn ? (
											<Button
												size="dense"
												variant="primary"
												disabled={signingIn !== null}
												onClick={() => void signInAgain(account)}
											>
												{signingIn === account.id ? "Waiting for the browser" : "Sign in again"}
											</Button>
										) : null}
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
								);
							})}
						</ul>
					)}
					<SectionError message={error} />

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
				<RemovedAccounts refreshKey={removedVersion} onDone={onSaved} />
			</div>
		</div>
	);
}

/** What the badge on an account row says, from what the last sync left behind. */
function accountStatus(account: MailAccount): { label: string; tone: string } {
	if (account.needsSignIn) return { label: "Sign in again", tone: "warn" };
	if (account.lastSyncError) {
		return /password|auth|credential|login/i.test(account.lastSyncError)
			? { label: "Password rejected", tone: "risk" }
			: { label: "Sync failed", tone: "risk" };
	}
	if (!account.hasCredential) return { label: "No password", tone: "warn" };
	if (!account.syncEnabled) return { label: "Paused", tone: "neutral" };
	if (account.lastSyncAt) return { label: `Synced ${formatClock(account.lastSyncAt)}`, tone: "ok" };
	return { label: "Not synced yet", tone: "neutral" };
}

function formatClock(iso: string): string {
	return new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
