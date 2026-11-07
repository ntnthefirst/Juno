import { useCallback, useState, type ReactNode } from "react";
import type { MailAccount, MailFolder, MailRule } from "@shared/types";
import { AddButton } from "../../../components/AddButton";
import { Button } from "../../../components/Button";
import { FormPage } from "../../../components/FormPage";
import { useLoaded } from "../../../lib/use-loaded";
import { formatWhen } from "../../mail/format";
import { Section, SectionError } from "../Section";
import { AccountFolders } from "./AccountFolders";
import { AccountRuleHistory } from "./AccountRuleHistory";
import { AccountRules } from "./AccountRules";
import { MailRuleForm } from "./MailRuleForm";

type MailAccountPageProps = {
	account: MailAccount;
	/** Back to the list of accounts. */
	onBack: () => void;
	/** The account's own form: servers, password, sync. */
	onEdit: () => void;
	onSaved: (message: string) => void;
};

/**
 * One mailbox: how it connects, which of its folders are pulled, the rules that
 * file its new mail, and what those rules have done. It is a page in the
 * settings window (decision 30), and a rule is a page on top of it.
 */
export function MailAccountPage({ account, onBack, onEdit, onSaved }: MailAccountPageProps) {
	const [rule, setRule] = useState<{ rule: MailRule | null } | null>(null);

	const loadFolders = useCallback(() => window.juno.mail.folders.list(account.id), [account.id]);
	const loadRules = useCallback(() => window.juno.mail.rules.list(account.id), [account.id]);
	const loadRuns = useCallback(() => window.juno.mail.rules.runs({ accountId: account.id, limit: 50 }), [account.id]);
	const folders = useLoaded(loadFolders);
	const rules = useLoaded(loadRules);
	const runs = useLoaded(loadRuns);
	const [changedFolders, setChangedFolders] = useState<Record<string, MailFolder>>({});

	const folderList: MailFolder[] | null =
		folders.status === "ready" ? folders.value.map((folder) => changedFolders[folder.id] ?? folder) : null;

	if (rule) {
		return (
			<MailRuleForm
				account={account}
				folders={folderList ?? []}
				rule={rule.rule}
				onClose={() => setRule(null)}
				onSaved={(saved) => {
					setRule(null);
					onSaved(`${saved.name} saved.`);
					rules.reload();
					runs.reload();
				}}
			/>
		);
	}

	return (
		<FormPage
			title={account.label}
			backLabel="Mail accounts"
			onBack={onBack}
			width="wide"
			description={account.label !== account.email ? account.email : undefined}
		>
			{/* Wrapped, so the first section is the first child and drops its rule. */}
			<div>
			<Section
				title="Details"
				anchor="mail-account-details"
				action={
					<Button size="dense" onClick={onEdit}>
						Edit account
					</Button>
				}
			>
				<dl className="grid max-w-[620px] grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-dense">
					<Detail term="Incoming">
						{account.imapHost}:{account.imapPort} {account.imapSecurity.toUpperCase()}
					</Detail>
					<Detail term="Outgoing">
						{account.smtpHost ? `${account.smtpHost}:${account.smtpPort} ${account.smtpSecurity.toUpperCase()}` : "None, this account only reads"}
					</Detail>
					<Detail term="Password">{account.hasCredential ? "Set, kept by the operating system" : "Not set"}</Detail>
					<Detail term="Sync">
						{account.syncEnabled
							? `Every ${account.syncIntervalMinutes} min, ${account.horizonDays} days back`
							: "Paused"}
					</Detail>
					<Detail term="Last synced">{account.lastSyncAt ? formatWhen(account.lastSyncAt) : "Not yet"}</Detail>
				</dl>
				{account.lastSyncError ? (
					<p data-selectable className="mt-2 text-sm text-[var(--risk)]">
						{account.lastSyncError}
					</p>
				) : null}
			</Section>

			<Section
				title="Rules"
				anchor="mail-rules"
				description="Checked from the top on new mail in the inbox after each sync, never on mail that is already there. They act on the mail server as well as here."
				action={<AddButton label="New rule" onClick={() => setRule({ rule: null })} />}
			>
				<AccountRules
					accountId={account.id}
					rules={rules.status === "ready" ? rules.value : null}
					folders={folderList ?? []}
					onEdit={(target) => setRule({ rule: target })}
					onChanged={() => {
						rules.reload();
						runs.reload();
					}}
				/>
				{rules.status === "error" ? <SectionError message={rules.message} /> : null}
			</Section>

			<Section
				title="History"
				anchor="mail-rule-history"
				description="What the rules did, newest first. An action that failed is written here and not tried again."
			>
				<AccountRuleHistory runs={runs.status === "ready" ? runs.value : null} />
				{runs.status === "error" ? <SectionError message={runs.message} /> : null}
			</Section>

			<Section
				title="Folders"
				anchor="mail-folders"
				description="Ticked folders are pulled on every sync. The inbox is on by default."
			>
				<AccountFolders
					folders={folderList}
					onChanged={(updated) => setChangedFolders((current) => ({ ...current, [updated.id]: updated }))}
				/>
				{folders.status === "error" ? <SectionError message={folders.message} /> : null}
			</Section>
			</div>
		</FormPage>
	);
}

type DetailProps = {
	term: string;
	children: ReactNode;
};

function Detail({ term, children }: DetailProps) {
	return (
		<>
			<dt className="text-[var(--ink-muted)]">{term}</dt>
			<dd className="min-w-0 truncate">{children}</dd>
		</>
	);
}
